package de.agiehl;

import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class DescriptionRenderer {
    private final CatalogService catalog;

    public DescriptionRenderer(CatalogService catalog) {
        this.catalog = catalog;
    }

    public String render(String name, String deckId, String qrValue,
                         List<CardModels.Effect> effects, List<CardModels.DescriptionToken> description) {
        var byId = effects.stream().collect(Collectors.toMap(CardModels.Effect::id, Function.identity()));
        var result = new StringBuilder();
        for (var token : description) {
            result.append(switch (token.kind()) {
                case "text" -> token.text();
                case "symbol" -> symbolIcon(token.symbolId());
                case "effect" -> effectText(byId.get(token.effectId()));
                case "variable" -> switch (token.variable()) {
                    case "name" -> name;
                    case "deckName" -> deckName(deckId);
                    case "qrValue" -> qrValue;
                    default -> "";
                };
                default -> "";
            });
        }
        return result.toString();
    }

    private String effectText(CardModels.Effect effect) {
        if (effect == null) {
            return "";
        }
        var type = catalog.effectType(effect.typeId());
        var label = "other".equals(effect.typeId()) ? effect.customName() : type == null ? effect.typeId() : type.name();
        return label + (effect.value() == null ? "" : " " + effect.value());
    }

    private String symbolIcon(String symbolId) {
        var symbol = catalog.symbol(symbolId);
        return symbol == null ? "[" + symbolId + "]" : symbol.icon();
    }

    private String deckName(String deckId) {
        var deck = catalog.deck(deckId);
        return deck == null ? deckId : deck.name();
    }
}
