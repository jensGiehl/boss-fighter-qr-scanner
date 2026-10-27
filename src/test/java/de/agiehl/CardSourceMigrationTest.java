package de.agiehl;

import static org.assertj.core.api.Assertions.assertThat;

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

    @Test
    void existingCardsReceiveBaseGameWithoutLosingTheirData() {
        var card = repository.findById(1L).orElseThrow();
        assertThat(card.sourceId()).isEqualTo("base-game");
        assertThat(card.name()).isEqualTo("Waldwächter");
        assertThat(card.qrValue()).isEqualTo("legacy://card");
        assertThat(card.version()).isZero();
    }
}
