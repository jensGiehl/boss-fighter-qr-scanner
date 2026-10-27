package de.agiehl;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

@Embeddable
public class StoredDescriptionToken {
    @Column(nullable = false, length = 10)
    private String kind;
    @Column(name = "token_text", length = 800)
    private String text;
    @Column(length = 40)
    private String symbolId;
    @Column(length = 36)
    private String effectId;
    @Column(name = "variable_name", length = 20)
    private String variable;

    protected StoredDescriptionToken() {}

    public StoredDescriptionToken(CardModels.DescriptionToken token) {
        kind = token.kind();
        text = token.text();
        symbolId = token.symbolId();
        effectId = token.effectId();
        variable = token.variable();
    }

    public CardModels.DescriptionToken toModel() {
        return new CardModels.DescriptionToken(kind, text, symbolId, effectId, variable);
    }
}
