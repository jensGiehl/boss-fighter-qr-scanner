package de.agiehl;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("scanner.catalog")
public record CatalogProperties(List<Deck> decks, List<EffectType> effectTypes, List<Symbol> symbols) {
    public record Deck(String id, String name, String icon) {}
    public record EffectType(String id, String name, String icon, String valueLabel,
                             @DefaultValue("true") boolean hasValue) {}
    public record Symbol(String id, String name, String icon) {}
}
