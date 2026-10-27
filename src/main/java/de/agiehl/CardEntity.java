package de.agiehl;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.hibernate.annotations.ColumnDefault;

@Entity
@Table(name = "cards", uniqueConstraints = @UniqueConstraint(name = "uk_cards_qr", columnNames = "qr_value"))
public class CardEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Version
    private Long version;

    @Column(name = "qr_value", nullable = false, length = 4096)
    private String qrValue;

    @Column(nullable = false, length = 80)
    private String cardNumber;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 40)
    private String deckId;

    @Column(nullable = false, length = 40)
    @ColumnDefault("'base-game'")
    private String sourceId;

    @ElementCollection
    @CollectionTable(name = "card_effects", joinColumns = @JoinColumn(name = "card_id"))
    @OrderColumn(name = "effect_position")
    private List<StoredEffect> effects = new ArrayList<>();

    @ElementCollection
    @CollectionTable(name = "card_description", joinColumns = @JoinColumn(name = "card_id"))
    @OrderColumn(name = "token_position")
    private List<StoredDescriptionToken> description = new ArrayList<>();

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    protected CardEntity() {}

    public CardEntity(CardModels.CardRequest request) {
        createdAt = Instant.now();
        update(request);
    }

    public void update(CardModels.CardRequest request) {
        qrValue = request.qrValue();
        cardNumber = request.cardNumber().strip();
        name = request.name().strip();
        deckId = request.deckId();
        sourceId = request.sourceId();
        effects.clear();
        request.effects().stream().map(StoredEffect::new).forEach(effects::add);
        description.clear();
        request.description().stream().map(StoredDescriptionToken::new).forEach(description::add);
        updatedAt = Instant.now();
    }

    public Long id() { return id; }
    public Long version() { return version; }
    public String qrValue() { return qrValue; }
    public String cardNumber() { return cardNumber; }
    public String name() { return name; }
    public String deckId() { return deckId; }
    public String sourceId() { return sourceId; }
    public List<CardModels.Effect> effects() { return effects.stream().map(StoredEffect::toModel).toList(); }
    public List<CardModels.DescriptionToken> description() { return description.stream().map(StoredDescriptionToken::toModel).toList(); }
    public Instant createdAt() { return createdAt; }
    public Instant updatedAt() { return updatedAt; }
}
