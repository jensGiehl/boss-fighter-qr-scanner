package de.agiehl;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

@Embeddable
public class StoredEffect {
    @Column(name = "effect_id", nullable = false, length = 36)
    private String id;
    @Column(nullable = false, length = 40)
    private String typeId;
    @Column(name = "effect_value")
    private Integer value;
    @Column(length = 80)
    private String customName;

    protected StoredEffect() {}

    public StoredEffect(CardModels.Effect effect) {
        id = effect.id();
        typeId = effect.typeId();
        value = effect.value();
        customName = effect.customName();
    }

    public CardModels.Effect toModel() {
        return new CardModels.Effect(id, typeId, value, customName);
    }
}
