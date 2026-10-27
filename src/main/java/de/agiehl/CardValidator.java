package de.agiehl;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class CardValidator {
    private static final Set<String> VARIABLES = Set.of("name", "cardNumber", "deckName", "qrValue");
    private static final Set<String> SOURCES = Set.of("base-game", "promo", "jungle-fever");
    private final CatalogService catalog;
    private final DescriptionRenderer renderer;

    public CardValidator(CatalogService catalog, DescriptionRenderer renderer) {
        this.catalog = catalog;
        this.renderer = renderer;
    }

    public void validate(CardModels.CardRequest request, boolean update) {
        var errors = new LinkedHashMap<String, String>();
        if (request == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Kartendaten fehlen.");
        }
        requiredText(errors, "qrValue", request.qrValue(), 2048, "QR-Code");
        requiredText(errors, "cardNumber", request.cardNumber(), 40, "Kartennummer");
        requiredText(errors, "name", request.name(), 50, "Name");
        if (!SOURCES.contains(request.sourceId())) {
            errors.put("sourceId", "Bitte eine gültige Herkunft auswählen.");
        }
        if (catalog.deck(request.deckId()) == null) {
            errors.put("deckId", "Bitte ein gültiges Deck auswählen.");
        }
        if (update && (request.version() == null || request.version() < 0)) {
            errors.put("version", "Die Version der bearbeiteten Karte fehlt.");
        }
        var effectIds = validateEffects(request, errors);
        validateDescription(request, effectIds, errors);
        if (errors.isEmpty()) {
            var text = renderer.render(request.name().strip(), request.cardNumber().strip(), request.deckId(),
                    request.qrValue(), request.effects(), request.description());
            if (length(text) > 400) {
                errors.put("description", "Die Beschreibung darf einschließlich Symbolen und Variablen höchstens 400 Zeichen enthalten.");
            }
        }
        if (!errors.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Bitte die markierten Felder korrigieren.", errors, null);
        }
    }

    private Set<String> validateEffects(CardModels.CardRequest request, Map<String, String> errors) {
        var ids = new HashSet<String>();
        if (request.effects() == null || request.effects().isEmpty() || request.effects().size() > 50) {
            errors.put("effects", "Bitte 1 bis 50 Effekte hinzufügen.");
            return ids;
        }
        for (int i = 0; i < request.effects().size(); i++) {
            var effect = request.effects().get(i);
            var field = "effects[" + i + "]";
            if (effect == null) {
                errors.put(field, "Der Effekt fehlt.");
                continue;
            }
            if (!isUuid(effect.id()) || !ids.add(effect.id())) {
                errors.put(field + ".id", "Effekte benötigen eindeutige UUIDs.");
            }
            var type = catalog.effectType(effect.typeId());
            if (type == null) {
                errors.put(field + ".typeId", "Unbekannter Effekt.");
            } else if (!"other".equals(type.id()) && type.hasValue() && effect.value() == null) {
                errors.put(field + ".value", "Bitte einen Zahlenwert eingeben.");
            } else if (!"other".equals(type.id()) && !type.hasValue() && effect.value() != null) {
                errors.put(field + ".value", "Dieser Effekt hat keinen Zahlenwert.");
            }
            if (effect.value() != null && Math.abs((long) effect.value()) > 9999) {
                errors.put(field + ".value", "Der Wert muss zwischen -9999 und 9999 liegen.");
            }
            if ("other".equals(effect.typeId())) {
                if (effect.customName() == null || effect.customName().length() > 80
                        || !effect.customName().matches("[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*")) {
                    errors.put(field + ".customName", "Bitte einen Effektnamen wie POISON_EXPLOSION eingeben (max. 80 Zeichen).");
                }
            } else if (effect.customName() != null && !effect.customName().isEmpty()) {
                errors.put(field + ".customName", "Ein eigener Effektname ist nur für Sonstige erlaubt.");
            }
        }
        return ids;
    }

    private void validateDescription(CardModels.CardRequest request, Set<String> effectIds, Map<String, String> errors) {
        if (request.description() == null || request.description().size() > 400) {
            errors.put("description", "Die Beschreibung muss eine Liste mit höchstens 400 Textbausteinen sein.");
            return;
        }
        for (int i = 0; i < request.description().size(); i++) {
            var token = request.description().get(i);
            var field = "description[" + i + "]";
            if (token == null || token.kind() == null) {
                errors.put(field, "Ungültiger Textbaustein.");
                continue;
            }
            switch (token.kind()) {
                case "text" -> {
                    if (token.text() == null || length(token.text()) > 400) {
                        errors.put(field, "Textbausteine dürfen höchstens 400 Zeichen enthalten.");
                    }
                    if (token.symbolId() != null || token.effectId() != null || token.variable() != null) {
                        errors.put(field, "Ein Textbaustein darf nur Text enthalten.");
                    }
                }
                case "symbol" -> {
                    if (catalog.symbol(token.symbolId()) == null || token.text() != null || token.effectId() != null || token.variable() != null) {
                        errors.put(field, "Unbekanntes oder ungültiges Symbol.");
                    }
                }
                case "effect" -> {
                    if (!effectIds.contains(token.effectId()) || token.text() != null || token.symbolId() != null || token.variable() != null) {
                        errors.put(field, "Der referenzierte Effekt fehlt oder der Textbaustein ist ungültig.");
                    }
                }
                case "variable" -> {
                    if (token.variable() == null || !VARIABLES.contains(token.variable()) || token.text() != null || token.symbolId() != null || token.effectId() != null) {
                        errors.put(field, "Unbekannte oder ungültige Variable.");
                    }
                }
                default -> errors.put(field, "Unbekannte Art von Textbaustein.");
            }
        }
    }

    private static void requiredText(Map<String, String> errors, String field, String value, int maximum, String label) {
        if (value == null || value.isBlank()) {
            errors.put(field, label + " darf nicht leer sein.");
        } else if (length(value) > maximum) {
            errors.put(field, label + " darf höchstens " + maximum + " Zeichen enthalten.");
        }
    }

    private static int length(String value) {
        return value.codePointCount(0, value.length());
    }

    private static boolean isUuid(String value) {
        try {
            return value != null && UUID.fromString(value).toString().equals(value);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
