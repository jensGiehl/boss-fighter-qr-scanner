package de.agiehl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CatalogAndDescriptionTest {
    @Test
    void usesCurrentCatalogLabelsWhenResolvingSavedVariables() {
        var effect = new CardModels.Effect(UUID.randomUUID().toString(), "melee", 3, null);
        var tokens = List.of(new CardModels.DescriptionToken("effect", null, null, effect.id(), null),
                new CardModels.DescriptionToken("text", " / ", null, null, null),
                new CardModels.DescriptionToken("variable", null, null, null, "deckName"));
        var original = new DescriptionRenderer(new CatalogService(catalog("Nahkampf", "Druide")));
        var renamed = new DescriptionRenderer(new CatalogService(catalog("Schwertangriff", "Waldvolk")));
        assertThat(original.render("Name", "42", "druid", "qr", List.of(effect), tokens)).isEqualTo("Nahkampf 3 / Druide");
        assertThat(renamed.render("Name", "42", "druid", "qr", List.of(effect), tokens)).isEqualTo("Schwertangriff 3 / Waldvolk");
    }

    @Test
    void rejectsDuplicateAndMissingConfigurationAtStartup() {
        var valid = catalog("Nahkampf", "Druide");
        assertThatThrownBy(() -> new CatalogService(new CatalogProperties(List.of(valid.decks().get(0), valid.decks().get(0)), valid.effectTypes(), valid.symbols())))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("duplicate id");
        assertThatThrownBy(() -> new CatalogService(new CatalogProperties(valid.decks(), List.of(valid.effectTypes().get(0)), valid.symbols())))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("other");
    }

    private CatalogProperties catalog(String effectName, String deckName) {
        return new CatalogProperties(List.of(new CatalogProperties.Deck("druid", deckName, "🌿")),
                List.of(new CatalogProperties.EffectType("melee", effectName, "⚔️", "Schaden", true),
                        new CatalogProperties.EffectType("other", "Sonstige", "✳️", "Wert", true)),
                List.of(new CatalogProperties.Symbol("star", "Stern", "★")));
    }
}
