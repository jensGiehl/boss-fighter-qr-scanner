package de.agiehl;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "spring.datasource.url=jdbc:h2:mem:source-migration-tests;DB_CLOSE_DELAY=-1",
        "spring.sql.init.mode=always",
        "spring.sql.init.schema-locations=classpath:legacy-cards.sql",
        "spring.jpa.hibernate.ddl-auto=update"
})
class CardSourceMigrationTest {
    @Autowired
    private CardRepository repository;
    @Autowired
    private CardService cards;
    @Autowired
    private DataSource dataSource;

    @Test
    void migratesExistingCardsAndAllowsFurtherCaptureAndEditing() throws Exception {
        var card = repository.findById(1L).orElseThrow();
        assertThat(card.sourceId()).isEqualTo("base-game");
        assertThat(card.name()).isEqualTo("Waldwächter");
        assertThat(card.qrValue()).isEqualTo("legacy://card");
        assertThat(card.version()).isZero();
        var loaded = cards.get(1L);
        assertThat(loaded.descriptionText()).isEqualTo("42");
        assertThat(loaded.description()).containsExactly(new CardModels.DescriptionToken("text", "42", null, null, null));
        try (var connection = dataSource.getConnection();
             var columns = connection.getMetaData().getColumns(connection.getCatalog(), connection.getSchema(), "CARDS", "CARD_NUMBER")) {
            assertThat(columns.next()).isFalse();
        }
        var effect = new CardModels.Effect(UUID.randomUUID().toString(), "melee", 3, null);
        var created = cards.create(new CardModels.CardRequest(null, "migrated://new-card", "Neue Karte", "druid", "promo", List.of(effect), List.of()));
        assertThat(cards.get(created.id()).name()).isEqualTo("Neue Karte");
        var updated = cards.update(card.id(), new CardModels.CardRequest(card.version(), card.qrValue(), "Aktualisiert", card.deckId(),
                card.sourceId(), List.of(effect), loaded.description()));
        assertThat(updated.descriptionText()).isEqualTo("42");
    }
}
