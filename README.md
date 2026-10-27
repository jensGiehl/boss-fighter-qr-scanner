# BossQR Card Scanner

Spring-Boot-Webanwendung zur schnellen Erfassung von Karten über QR-Codes. Die Daten liegen in einer dateibasierten H2-Datenbank. Das mobile Interface verwendet Bootstrap als Webjar; Scanner und Editor werden mit der Anwendung ausgeliefert.

## Schnellstart mit Docker

Docker mit Compose installieren und im Projektverzeichnis ausführen:

```bash
docker compose up -d --build
```

Anschließend [http://localhost:8089](http://localhost:8089) öffnen. **8089 ist der Port am Host**, 8080 der Port im Container. Der Container läuft als unprivilegierter Benutzer. Das benannte Volume `bossqr-card-scanner-data` speichert die H2-Dateien unter `/app/data` und bleibt bei einem Containerwechsel erhalten.

```bash
docker compose logs -f scanner
docker compose down
```

`docker compose down` lässt die Daten bestehen. `docker compose down --volumes` löscht auch die Datenbank. Für eine konsistente Sicherung zuerst die Anwendung stoppen und anschließend das Volume sichern.

Das Image wird in mehreren Stufen mit Maven 3.9.16 und Java 27 gebaut. Der Build führt die Tests aus; das Laufzeitimage verwendet Eclipse Temurin 27 JRE.

## Einzelnen Container starten

Ein lokales Image lässt sich so bauen und starten:

```bash
docker build -t bossqr-card-scanner:local .
docker rm -f bossqr-card-scanner 2>/dev/null

docker run -d \
  --name bossqr-card-scanner \
  --pull=never \
  -p 8089:8080 \
  -v bossqr-card-scanner-data:/app/data \
  bossqr-card-scanner:local
```

Für ein in einer Registry veröffentlichtes Image lautet das entsprechende Skript:

```bash
IMAGE="ghcr.io/DEIN-BENUTZER/bossqr-card-scanner:latest"
docker rm -f bossqr-card-scanner 2>/dev/null

docker run -d \
  --name bossqr-card-scanner \
  --pull=always \
  -p 8089:8080 \
  -v bossqr-card-scanner-data:/app/data \
  "$IMAGE"
```

`IMAGE` durch die eigene Registry-Adresse ersetzen und das Image dort vorher veröffentlichen. Ein vorveröffentlichtes Projektimage wird nicht vorausgesetzt. Auch hier ist **8089 der Host-Port**. Die Beispiele verwenden Bash; in PowerShell können die mehrzeiligen Docker-Befehle in eine Zeile geschrieben werden.

## Lokal mit Maven starten

Voraussetzungen: JDK 27 und Maven 3.9.16 oder neuer. Alle Dateien und HTTP-Inhalte verwenden UTF-8; das Spring-Boot-Banner ist deaktiviert.

```bash
mvn verify
mvn spring-boot:run
```

Die lokale Anwendung ist unter [http://localhost:8080](http://localhost:8080) erreichbar. Ohne eigene Einstellung verwendet sie die H2-Datei `./data/cards`. Der Datenbankpfad kann über die Umgebungsvariable `DB_PATH` geändert werden, beispielsweise auf `/app/data/cards` im Container. Den Pfad ohne H2-Dateiendung angeben. `SERVER_PORT` ändert den HTTP-Port der Anwendung.

## Karten erfassen und bearbeiten

1. **Kamera starten** wählen und den Kamerazugriff im Browser erlauben. Bei mehreren Kameras lässt sich die Kamera umschalten; auf Mobilgeräten wird die Rückkamera bevorzugt.
2. Einen QR-Code ins Bild halten. Nach der Erkennung erscheint sein Wert und die Kamera wird ausgeschaltet.
3. Herkunft, Name, Deck, Effekte und Beschreibung erfassen. Der Fokus liegt direkt auf dem Kartennamen; die weitere Erfassung ist auch mit der Tastatur möglich.
4. **Speichern & weiter** speichert die Karte und aktiviert die Kamera für den nächsten QR-Code.

Die manuelle QR-Eingabe hilft, wenn keine Kamera verfügbar ist oder ein Code schlecht lesbar ist. Über die Kartenliste lassen sich bereits erfasste Karten suchen und zur Bearbeitung öffnen. Der Name ist auf 50 Zeichen begrenzt, die gerenderte Beschreibung auf 400 Zeichen.

Als **Herkunft** stehen **Basisspiel**, **Promo** und **[Jungle Fever (Erweiterung)](https://boardgamegeek.com/boardgameexpansion/474431/boss-fighters-qr-jungle-fever)** zur Auswahl. Die Herkunft wird pro Karte gespeichert, in der Kartenliste angezeigt und kann beim Bearbeiten geändert werden. Die letzte ausdrücklich gewählte Herkunft wird im jeweiligen Browser für die nächste Karte gemerkt, auch nach einem Neuladen. Ohne verfügbaren Browserspeicher gilt dies bis zum Neuladen. Das Öffnen einer vorhandenen Karte ändert die gemerkte Auswahl nicht. Standard ist Basisspiel; vorhandene Datenbankeinträge erhalten beim Start ebenfalls diesen Wert.

Die Karten-API verwendet dafür `sourceId` mit `base-game`, `promo` oder `jungle-fever`. Fehlt das Feld in einer Anfrage, wird zur Kompatibilität mit bisherigen Clients `base-game` verwendet; unbekannte Werte werden abgewiesen.

Karten besitzen keine Kartennummer. Bei bestehenden Datenbanken wird das frühere Nummernfeld beim Start entfernt; bereits eingefügte Nummernvariablen bleiben als normaler Beschreibungstext erhalten.

Jeder QR-Wert kann nur einmal gespeichert werden. Ein bereits vorhandener QR-Code wird als Konflikt gemeldet. Eine Versionsprüfung verhindert, dass parallele Bearbeitungen dieselbe Karte unbemerkt überschreiben; in diesem Fall die aktuelle Karte neu laden.

Decks werden als große Symbolbuttons mit kleinen Beschriftungen angeboten. Effekte können hinzugefügt, geändert, mit Pfeilen sortiert und gelöscht werden. Für numerische Effektwerte sind Ganzzahlen von −9999 bis 9999 erlaubt. **Karten ziehen**, **Heilen**, **Gift zufügen** und **Direkter Schaden** besitzen jeweils einen Zahlenwert. **Weitere Aktion** wird mit einem Blitz dargestellt und benötigt keinen Zahlenwert; beim Wechsel zu diesem Typ wird ein vorheriger Wert entfernt. Gift verwendet einen grünen Tropfen, direkter Schaden ein gebrochenes Herz. Der Effekt **Sonstige** besitzt einen zusätzlichen Namen im Format einer Java-Konstante, beispielsweise `POISON_EXPLOSION`; sein numerischer Wert ist optional. Bereits verwendete Namen stehen als Autovervollständigung zur Verfügung.

Der Beschreibungseditor unterstützt Fließtext, neun Symbole und Effektvariablen. Beim Hinzufügen eines Effekts wird automatisch eine Referenz in einer eigenen Zeile am Ende der Beschreibung ergänzt, ohne vorhandenen oder markierten Text zu ersetzen. Weitere Verweise lassen sich an der aktuellen Textposition einfügen; ihre Darstellung bleibt mit dem zugehörigen Effekt verbunden. Aus **Nahkampf 3** wird deshalb automatisch **Nahkampf 4**, sobald der Effektwert geändert wird. Beim Verschieben eines Effekts mit den Pfeilen werden die Effektverweise in der Beschreibung entsprechend der Effektliste neu sortiert; Freitext, Symbole und Zeilenumbrüche bleiben erhalten. Die Zuordnung erfolgt über die Effekt-ID, auch bei mehreren Effekten desselben Typs. Die Reihenfolge bleibt beim Speichern und erneuten Öffnen erhalten. Rückgängig/Wiederholen im Editor stellt keine frühere Reihenfolge der Verweise wieder her. Beim Löschen eines Effekts werden sämtliche zugehörigen Verweise aus der Beschreibung entfernt; Freitext, Symbole und andere Verweise bleiben erhalten. Rückgängig/Wiederholen im Editor stellt keine Verweise auf gelöschte Effekte wieder her. Überschreitet die Beschreibung durch eine automatische Referenz das Limit von 400 Zeichen, bleibt die Referenz sichtbar und das Speichern ist bis zur Kürzung gesperrt. Zusätzlich lassen sich Kartenname, Deckname und QR-Wert als Variablen einfügen.

**Strg+Enter** bzw. **Cmd+Enter** speichert die aktuelle Karte. Die Deckauswahl kann für die nächste Karte gemerkt werden.

## Kamerazugriff auf Mobilgeräten

Browser erlauben `getUserMedia` für eine Kamera nur in einem sicheren Kontext: HTTPS oder `localhost`. Am Entwicklungsrechner funktioniert `http://localhost:8089`. Die Adresse `http://192.168.…:8089` auf einem Smartphone erfüllt diese Voraussetzung üblicherweise nicht. Die Voraussetzungen beschreibt die [MDN-Dokumentation zum Kamerazugriff](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

Für Smartphone-Erfassung die Anwendung über einen HTTPS-Reverse-Proxy mit einem auf dem Gerät vertrauten Zertifikat aufrufen. Der Proxy leitet intern an Port 8089 des Hosts bzw. Port 8080 im Docker-Netz weiter. In den Website-Einstellungen des Browsers muss der Kamerazugriff erlaubt sein. Ein Wechsel der Kamera beendet den bisherigen Kamerastream, bevor der neue gestartet wird.

## Katalog konfigurieren

Decknamen und Symbole, Effekttypen und Beschreibungssymbole werden per YAML konfiguriert. Die Vorgabekonfiguration ist `src/main/resources/catalog.yaml`. Für eigene Symbole zunächst die dortige Datei kopieren und die Einträge anpassen. Die Katalogdatei wird beim Start eingelesen; nach Änderungen die Anwendung neu starten.

Die Standarddecks sind Druide, **Dryade**, **Goblin**, **Paladin**, **Hügel-Halbling**, **Kupfer-Zwerg**, **Wald-Elfe**, Krieger, **Dschungel-Troll**, Schamane, Schurke, Magier, **Gegenstände (🎒)** und **Beute 1 bis 10**. Alle Decks lassen sich auswählen, für die nächste Karte merken und in der Kartenliste filtern. Dryade, Goblin und Paladin sind eigene Decks mit den technischen IDs `dryad`, `goblin` und `paladin`.

Die in der folgenden Tabelle aufgeführten Decks verwenden den Vorlagen nachempfundene schwarze SVG-Grafiken mit transparentem Hintergrund. Deckauswahl und Kartenliste verwenden dieselben lokalen Grafiken. Die technischen IDs vorhandener Decks bleiben erhalten, sodass gespeicherte Karten weiterhin zugeordnet werden. Die Beutedecks verwenden ein goldenes Sternmedaillon als SVG mit transparentem Hintergrund; die Zahl wird dynamisch darüber dargestellt.

Die Standardeffekte sind Nahkampf, Nahkampf-Verstärkung, Fernkampf, Fernkampf-Verstärkung, Karten ziehen, Heilen, Weitere Aktion, Gift zufügen, Direkter Schaden und Sonstige. Für die Beschreibung stehen Schwert, Schild, Feuer, Herz, Blitz, Stern, Karten ziehen, Gift und Gebrochenes Herz bereit.

Die Konfigurationsfelder sehen so aus; dieser Auszug zeigt nur einige Einträge:

```yaml
scanner:
  catalog:
    decks:
      - id: druid
        name: Druide
        icon: "druid"
    effect-types:
      - id: melee
        name: Nahkampf
        icon: "⚔️"
        value-label: Schaden
      - id: other
        name: Sonstige
        icon: "✳️"
        value-label: Wert (optional)
      - id: extra-action
        name: Weitere Aktion
        icon: "⚡"
        has-value: false
    symbols:
      - id: sword
        name: Schwert
        icon: "⚔️"
```

`id` ist der stabile technische Schlüssel, `name` die sichtbare Beschriftung, `icon` das Unicode-/Emoji-Symbol, für Beutedecks der Wert `loot:N` oder einer der lokalen Grafikmarker aus der folgenden Tabelle. Diese Einträge auch in einer eigenen Katalogdatei übernehmen. Die jeweiligen SVG-Dateien liegen unter `src/main/resources/static/icons/` und heißen wie der Grafikmarker mit der Endung `.svg`.

| `id` | `name` | `icon` | Motiv |
| --- | --- | --- | --- |
| `druid` | Druide | `druid` | Verzweigtes Zeichen |
| `dryad` | Dryade | `dryad` | Schmales Pflanzenzeichen mit länglichen Innenräumen |
| `goblin` | Goblin | `goblin` | Gebogenes Runenzeichen mit inneren Streben |
| `paladin` | Paladin | `paladin` | Runenzeichen mit langem Querarm |
| `halfling` | Hügel-Halbling | `hill-halfling` | Rauchende Pfeife |
| `dwarf` | Kupfer-Zwerg | `copper-dwarf` | Kantiges Runenzeichen |
| `elf` | Wald-Elfe | `forest-elf` | Geschwungene Blattranke mit Spirale |
| `warrior` | Krieger | `warrior` | Langgezogenes kantiges Zeichen |
| `rogue` | Schurke | `rogue` | Zwei verbundene, entgegengesetzte Klingen |
| `mage` | Magier | `mage` | Geschwungene Flamme mit Funken |
| `troll` | Dschungel-Troll | `jungle-troll` | Ranke |
| `shaman` | Schamane | `shaman` | Feder mit geschwungener Längsachse |

`value-label` benennt das Zahlenfeld eines Effekts. `has-value` ist standardmäßig `true`; `false` blendet das Zahlenfeld aus und erlaubt ausschließlich `null` als Wert. Der Effekttyp `other` aktiviert das zusätzliche Namensfeld für Java-Konstanten und behält seinen optionalen Zahlenwert; hierfür `has-value` bei `true` belassen. Eigene Effekttypen lassen sich ergänzen. Eine externe Liste ersetzt die jeweilige Standardliste vollständig; für kleine Anpassungen daher die vollständige Vorgabedatei kopieren und bearbeiten. Icons werden als Text konfiguriert; Bilddateien und HTML-Markup sind keine Iconwerte. Den voreingestellten Gift-Tropfen (`id: poison`, `icon: "💧"`) stellt die Oberfläche mit einer lokalen SVG-Datei grün dar. Im reinen Beschreibungstext der API bleibt das Unicode-Symbol erhalten.

Weitere Beutedecks benötigen keine eigene Grafik und keine Codeänderung. `loot:N` zeichnet dieselbe SVG-Grafik mit der Zahl `N` von **1 bis 99**; führende Nullen werden nicht verwendet. Für **Beute 11** und **Beute 12** diese Einträge an die vollständige Deckliste in der Katalogdatei anhängen und anschließend die Anwendung neu starten:

```yaml
      - id: loot-11
        name: Beute 11
        icon: "loot:11"
      - id: loot-12
        name: Beute 12
        icon: "loot:12"
```

Die API verwendet für die Zuordnung `deckId`, beispielsweise `loot-11`. Der Beschreibungsverweis `deckName` und der Deckfilter übernehmen den konfigurierten Namen automatisch. Bei einer externen Katalogdatei müssen die bisherigen Decks in der Liste erhalten bleiben.

Eine eigene Datei lässt sich schreibgeschützt in Docker einbinden:

```bash
docker rm -f bossqr-card-scanner 2>/dev/null

docker run -d \
  --name bossqr-card-scanner \
  --pull=never \
  -p 8089:8080 \
  -v bossqr-card-scanner-data:/app/data \
  --mount type=bind,src="$(pwd)/catalog.yaml",dst=/app/config/catalog.yaml,readonly \
  -e CATALOG_FILE=/app/config/catalog.yaml \
  bossqr-card-scanner:local
```

Die Quelldatei muss existieren. Bei Docker Desktop unter Windows einen absoluten Windows-Pfad für `src` angeben. Der Datenbankordner muss für die Container-UID/GID `10001:10001` beschreibbar sein, falls statt des benannten Volumes ein Hostordner verwendet wird. Ein zusätzlicher Ein- oder Ausgabeordner wird nicht benötigt.

Für Compose dieselbe Einstellung ergänzen:

```yaml
services:
  scanner:
    environment:
      DB_PATH: /app/data/cards
      CATALOG_FILE: /app/config/catalog.yaml
    volumes:
      - card-data:/app/data
      - ./catalog.yaml:/app/config/catalog.yaml:ro
```

Stabile IDs für vorhandene Decks, Effekte und Symbole beibehalten, damit gespeicherte Karten weiter den passenden Einträgen zugeordnet werden können. Namen und die vorläufigen Unicode-/Emoji-Symbole lassen sich über die Datei ändern.

Die Umgebungsvariablen `DB_USERNAME` und `DB_PASSWORD` konfigurieren die H2-Anmeldung. Standardmäßig ist der Benutzer `sa` ohne Passwort eingestellt; die H2-Webkonsole ist nicht aktiviert.

## Technik und Prüfung

Java 27, Maven, Spring Boot 4.1.1, Spring Data JPA und H2; Java-Packages beginnen mit `de.agiehl`. Die Browseroberfläche wird direkt von Spring Boot bereitgestellt. Es wird kein eigener Node- oder CDN-Build benötigt.

`/actuator/health` liefert den Gesundheitsstatus der Anwendung. Die Docker-Basisimages stammen aus den offiziellen Repositories [Eclipse Temurin](https://hub.docker.com/_/eclipse-temurin) und [Maven](https://hub.docker.com/_/maven).

```bash
mvn verify
docker compose up -d --build
```

Der Maven-Build prüft insbesondere Speicherung, Validierung und die dynamische Beschreibung. Den Kamerazugriff zusätzlich auf dem vorgesehenen Mobilgerät mit HTTPS prüfen: Erkennen, Umschalten, Speichern, erneutes Scannen und Bearbeiten einer vorhandenen Karte.

Die automatisierten Tests für den Kameraablauf laufen optional mit Node.js (nur integrierte Testwerkzeuge, keine Paketinstallation):

```bash
node --test tests/js/*.test.mjs
```

Sie prüfen unter anderem das sofortige Freigeben aller Kameratracks nach einem Scan, Kamerawechsel, verspätete Kameraanfragen, QR-Fallback und Fehler bei verweigerten Berechtigungen.

Die optionalen Browsertests prüfen den Beschreibungseditor, darunter Cursorposition, automatisches Hinzufügen und Entfernen von Effektverweisen, dynamische Verweise, Unicode-Limit, Einfügen als Klartext, Zeilenumbrüche und Rückgängig/Wiederholen. Weitere Tests prüfen die Herkunftsauswahl einschließlich Speichern, Bearbeiten, Verwerfen und Neuladen sowie die fünf zusätzlichen Effekte, Typwechsel und die mobile Darstellung mit grünem Gift-Tropfen. Für Beutedecks werden ein- und zweistellige SVG-Zahlen, der transparente Hintergrund, die mobile Darstellung sowie Speichern, Bearbeiten und Filtern geprüft. Sie benötigen Node.js 22 oder neuer und einen vorhandenen Microsoft Edge. Jeder Test verwendet ein eigenes temporäres Browserprofil; ohne verfügbaren Browser werden die Tests übersprungen. Mit `EDGE_BINARY` lässt sich der Pfad zum Browser vorgeben.

```bash
node --test tests/browser/description-editor.test.mjs
node --test tests/browser/effects.test.mjs
node --test tests/browser/loot-decks.test.mjs
```
