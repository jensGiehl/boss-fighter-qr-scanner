package de.agiehl;

public class DuplicateQrException extends RuntimeException {
    private final String qrValue;

    public DuplicateQrException(String qrValue) {
        super("Dieser QR-Code wurde bereits erfasst.");
        this.qrValue = qrValue;
    }

    public String qrValue() { return qrValue; }
}
