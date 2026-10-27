package de.agiehl;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class CardModels {
    private CardModels() {}

    public record Effect(String id, String typeId, Integer value, String customName) {}

    public record DescriptionToken(String kind, String text, String symbolId, String effectId, String variable) {}

    public record CardRequest(Long version, String qrValue, String name, String deckId, String sourceId,
                              List<Effect> effects, List<DescriptionToken> description) {
        public CardRequest {
            sourceId = sourceId == null ? "base-game" : sourceId;
        }
    }

    public record CardResponse(Long id, Long version, String qrValue, String name, String deckId, String sourceId,
                               List<Effect> effects, List<DescriptionToken> description, String descriptionText,
                               Instant createdAt, Instant updatedAt) {}

    public record CardPage(List<CardResponse> content, int page, int totalPages, long totalElements) {}

    public record ApiError(String message, Map<String, String> fieldErrors, Long existingCardId) {}
}
