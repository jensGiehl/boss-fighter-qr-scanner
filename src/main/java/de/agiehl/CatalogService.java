package de.agiehl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;

@Service
public class CatalogService {
    private final CatalogProperties catalog;
    private final Map<String, CatalogProperties.Deck> decks;
    private final Map<String, CatalogProperties.EffectType> effectTypes;
    private final Map<String, CatalogProperties.Symbol> symbols;

    public CatalogService(CatalogProperties catalog) {
        this.catalog = catalog;
        decks = index(catalog.decks(), CatalogProperties.Deck::id, "decks");
        effectTypes = index(catalog.effectTypes(), CatalogProperties.EffectType::id, "effect-types");
        symbols = index(catalog.symbols(), CatalogProperties.Symbol::id, "symbols");
        catalog.decks().forEach(deck -> validateDisplay(deck.name(), deck.icon(), "deck " + deck.id()));
        catalog.effectTypes().forEach(effect -> validateDisplay(effect.name(), effect.icon(), "effect " + effect.id()));
        catalog.symbols().forEach(symbol -> validateDisplay(symbol.name(), symbol.icon(), "symbol " + symbol.id()));
        if (!effectTypes.containsKey("other")) {
            throw new IllegalStateException("scanner.catalog.effect-types must include the id 'other'");
        }
    }

    public CatalogProperties catalog() {
        return catalog;
    }

    public CatalogProperties.Deck deck(String id) {
        return id == null ? null : decks.get(id);
    }

    public CatalogProperties.EffectType effectType(String id) {
        return id == null ? null : effectTypes.get(id);
    }

    public CatalogProperties.Symbol symbol(String id) {
        return id == null ? null : symbols.get(id);
    }

    private static <T> Map<String, T> index(List<T> values, Function<T, String> id, String property) {
        if (values == null || values.isEmpty()) {
            throw new IllegalStateException("scanner.catalog." + property + " must not be empty");
        }
        var result = new LinkedHashMap<String, T>();
        for (var value : values) {
            if (value == null) {
                throw new IllegalStateException("Empty entry in scanner.catalog." + property);
            }
            var identifier = id.apply(value);
            if (identifier == null || !identifier.matches("[a-z][a-z0-9-]{0,39}") || result.putIfAbsent(identifier, value) != null) {
                throw new IllegalStateException("Invalid or duplicate id in scanner.catalog." + property + ": " + identifier);
            }
        }
        return Map.copyOf(result);
    }

    private static void validateDisplay(String name, String icon, String property) {
        if (name == null || name.isBlank() || icon == null || icon.isBlank()) {
            throw new IllegalStateException("Name and icon are required for " + property);
        }
        if (name.codePointCount(0, name.length()) > 80 || icon.codePointCount(0, icon.length()) > 120) {
            throw new IllegalStateException("Name or icon is too long for " + property);
        }
    }
}
