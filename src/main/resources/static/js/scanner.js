export class QrScanner {
    constructor({video, onScan, onState, onDevices, onError}) {
        this.video = video;
        this.onScan = onScan ?? (() => {});
        this.onState = onState ?? (() => {});
        this.onDevices = onDevices ?? (() => {});
        this.onError = onError ?? (() => {});
        this.session = 0;
        this.deviceRequest = 0;
        this.stream = null;
        this.frame = null;
        this.scanning = false;
        this.decoding = false;
        this.disposed = false;
        this.state = "stopped";
        this.lastFrameTime = 0;
        this.detector = null;
        this.detectorPreparation = null;
        this.canvas = document.createElement("canvas");
        this.context = this.canvas.getContext("2d", {willReadFrequently: true});
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.setAttribute("playsinline", "");
        this.handleDeviceChange = () => this.refreshDevices();
        navigator.mediaDevices?.addEventListener("devicechange", this.handleDeviceChange);
    }

    async start(deviceId) {
        if (this.disposed) return false;
        const session = ++this.session;
        this.releaseStream();
        this.setState("starting");
        try {
            if (!window.isSecureContext) {
                throw new Error("Die Kamera benötigt eine sichere Verbindung. Öffne die Anwendung über HTTPS oder auf diesem Gerät über localhost.");
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error("Dieser Browser stellt keinen Kamerazugriff bereit. Verwende einen aktuellen Browser über HTTPS oder localhost.");
            }
            await this.prepareDetector();
            if (session !== this.session || this.disposed) return false;
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: deviceId
                    ? {deviceId: {exact: deviceId}, width: {ideal: 1280}, height: {ideal: 720}}
                    : {facingMode: {ideal: "environment"}, width: {ideal: 1280}, height: {ideal: 720}}
            });
            if (session !== this.session || this.disposed) {
                stream.getTracks().forEach(track => track.stop());
                return false;
            }
            this.stream = stream;
            stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
                if (session !== this.session || !this.scanning) return;
                this.stop();
                this.onError("Die Kamera wurde beendet. Starte sie erneut, um weiter zu scannen.");
            }, {once: true}));
            this.video.srcObject = stream;
            await this.video.play();
            if (session !== this.session || this.disposed) return false;
            this.scanning = true;
            this.lastFrameTime = 0;
            this.setState("scanning");
            this.scheduleFrame(session);
            this.refreshDevices();
            return true;
        } catch (error) {
            if (session !== this.session || this.disposed) return false;
            ++this.session;
            this.releaseStream();
            this.setState("stopped");
            this.onError(this.errorMessage(error));
            return false;
        }
    }

    stop() {
        ++this.session;
        this.releaseStream();
        this.setState("stopped");
    }

    releaseStream() {
        this.scanning = false;
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.video.pause();
        this.video.srcObject = null;
    }

    async refreshDevices() {
        if (this.disposed || !navigator.mediaDevices?.enumerateDevices) return [];
        const request = ++this.deviceRequest;
        try {
            const devices = (await navigator.mediaDevices.enumerateDevices())
                .filter(device => device.kind === "videoinput")
                .map((device, index) => ({
                    deviceId: device.deviceId,
                    groupId: device.groupId,
                    kind: device.kind,
                    label: device.label || `Kamera ${index + 1}`
                }));
            if (!this.disposed && request === this.deviceRequest) this.onDevices(devices);
            return devices;
        } catch (error) {
            if (!this.disposed && request === this.deviceRequest) this.onError(this.errorMessage(error));
            return [];
        }
    }

    async prepareDetector() {
        if (!this.detectorPreparation) {
            this.detectorPreparation = (async () => {
                if ("BarcodeDetector" in window) {
                    try {
                        const formats = await window.BarcodeDetector.getSupportedFormats();
                        if (formats.includes("qr_code")) {
                            this.detector = new window.BarcodeDetector({formats: ["qr_code"]});
                        }
                    } catch {
                        this.detector = null;
                    }
                }
            })();
        }
        await this.detectorPreparation;
        if (!this.detector && typeof window.jsQR !== "function") {
            throw new Error("Die QR-Erkennung konnte nicht geladen werden. Lade die Seite erneut.");
        }
    }

    scheduleFrame(session) {
        if (!this.scanning || session !== this.session || this.disposed) return;
        this.frame = requestAnimationFrame(time => this.decodeFrame(session, time));
    }

    async decodeFrame(session, time) {
        this.frame = null;
        if (!this.scanning || session !== this.session || this.disposed) return;
        if (this.decoding || time - this.lastFrameTime < 100 || this.video.readyState < 2 || !this.video.videoWidth) {
            this.scheduleFrame(session);
            return;
        }
        this.decoding = true;
        this.lastFrameTime = time;
        try {
            const scale = Math.min(1, 960 / Math.max(this.video.videoWidth, this.video.videoHeight));
            const width = Math.max(1, Math.round(this.video.videoWidth * scale));
            const height = Math.max(1, Math.round(this.video.videoHeight * scale));
            if (this.canvas.width !== width) this.canvas.width = width;
            if (this.canvas.height !== height) this.canvas.height = height;
            this.context.drawImage(this.video, 0, 0, width, height);
            let value = null;
            if (this.detector) {
                try {
                    const codes = await this.detector.detect(this.canvas);
                    value = codes.find(code => typeof code.rawValue === "string" && code.rawValue.length)?.rawValue ?? null;
                } catch {
                    this.detector = null;
                }
            }
            if (!value && !this.detector) {
                if (typeof window.jsQR !== "function") {
                    throw new Error("Die QR-Erkennung ist nicht verfügbar. Lade die Seite erneut.");
                }
                const pixels = this.context.getImageData(0, 0, width, height);
                value = window.jsQR(pixels.data, width, height, {inversionAttempts: "attemptBoth"})?.data ?? null;
            }
            if (!this.scanning || session !== this.session || this.disposed) return;
            if (typeof value === "string" && value.length) {
                this.stop();
                this.onScan(value);
                return;
            }
        } catch (error) {
            if (session === this.session && !this.disposed) {
                this.stop();
                this.onError(this.errorMessage(error));
            }
        } finally {
            this.decoding = false;
            this.scheduleFrame(session);
        }
    }

    setState(state) {
        if (this.state === state) return;
        this.state = state;
        this.onState(state);
    }

    errorMessage(error) {
        const messages = {
            NotAllowedError: "Der Kamerazugriff wurde nicht erlaubt. Erlaube die Kamera in den Website-Einstellungen und starte sie erneut.",
            PermissionDeniedError: "Der Kamerazugriff wurde nicht erlaubt. Erlaube die Kamera in den Website-Einstellungen und starte sie erneut.",
            NotFoundError: "Es wurde keine Kamera gefunden. Verbinde eine Kamera oder verwende ein Gerät mit Kamera.",
            DevicesNotFoundError: "Es wurde keine Kamera gefunden. Verbinde eine Kamera oder verwende ein Gerät mit Kamera.",
            NotReadableError: "Die Kamera kann gerade nicht geöffnet werden. Schließe andere Anwendungen, die sie verwenden, und versuche es erneut.",
            TrackStartError: "Die Kamera kann gerade nicht geöffnet werden. Schließe andere Anwendungen, die sie verwenden, und versuche es erneut.",
            OverconstrainedError: "Die ausgewählte Kamera ist nicht mehr verfügbar. Wähle eine andere Kamera.",
            ConstraintNotSatisfiedError: "Die ausgewählte Kamera ist nicht mehr verfügbar. Wähle eine andere Kamera.",
            AbortError: "Der Kamerastart wurde unterbrochen. Versuche es erneut.",
            SecurityError: "Der Browser blockiert die Kamera. Prüfe die Website-Berechtigungen und verwende HTTPS oder localhost."
        };
        return messages[error?.name] || error?.message || "Die Kamera konnte nicht gestartet werden. Prüfe die Kameraberechtigung und versuche es erneut.";
    }

    dispose() {
        this.stop();
        this.disposed = true;
        ++this.deviceRequest;
        navigator.mediaDevices?.removeEventListener("devicechange", this.handleDeviceChange);
    }
}
