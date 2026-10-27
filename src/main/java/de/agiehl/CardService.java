package de.agiehl;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import jakarta.persistence.criteria.Predicate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class CardService {
    private final CardRepository repository;
    private final CardValidator validator;
    private final DescriptionRenderer renderer;

    public CardService(CardRepository repository, CardValidator validator, DescriptionRenderer renderer) {
        this.repository = repository;
        this.validator = validator;
        this.renderer = renderer;
    }

    public CardModels.CardPage list(String query, String deckId, int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Ungültige Seitengröße oder Seitennummer.");
        }
        var cards = repository.findAll(search(query, deckId), PageRequest.of(page, size, Sort.by(Sort.Order.desc("updatedAt"), Sort.Order.desc("id"))));
        return new CardModels.CardPage(cards.getContent().stream().map(this::response).toList(), cards.getNumber(), cards.getTotalPages(), cards.getTotalElements());
    }

    public CardModels.CardResponse get(long id) {
        return response(find(id));
    }

    @Transactional
    public CardModels.CardResponse create(CardModels.CardRequest request) {
        validator.validate(request, false);
        ensureUniqueQr(request.qrValue(), null);
        var card = new CardEntity(request);
        return save(card, request.qrValue());
    }

    @Transactional
    public CardModels.CardResponse update(long id, CardModels.CardRequest request) {
        validator.validate(request, true);
        var card = find(id);
        if (!Objects.equals(card.version(), request.version())) {
            throw new ApiException(HttpStatus.CONFLICT, "Diese Karte wurde inzwischen geändert. Bitte neu laden und die Änderungen erneut eintragen.");
        }
        ensureUniqueQr(request.qrValue(), id);
        card.update(request);
        return save(card, request.qrValue());
    }

    public List<String> customNames(String query) {
        var normalized = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        return repository.findCustomNames(normalized.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%").stream().limit(30).toList();
    }

    private CardModels.CardResponse save(CardEntity card, String qrValue) {
        try {
            repository.saveAndFlush(card);
            return response(card);
        } catch (DataIntegrityViolationException exception) {
            throw new DuplicateQrException(qrValue);
        }
    }

    private CardEntity find(long id) {
        return repository.findById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Die Karte wurde nicht gefunden."));
    }

    private void ensureUniqueQr(String qrValue, Long currentId) {
        repository.findByQrValue(qrValue).filter(card -> !Objects.equals(card.id(), currentId)).ifPresent(card -> {
            throw new ApiException(HttpStatus.CONFLICT, "Dieser QR-Code wurde bereits erfasst.", java.util.Map.of("qrValue", "QR-Code bereits vorhanden."), card.id());
        });
    }

    private CardModels.CardResponse response(CardEntity card) {
        var effects = card.effects();
        var description = card.description();
        return new CardModels.CardResponse(card.id(), card.version(), card.qrValue(), card.name(), card.deckId(), card.sourceId(), effects, description,
                renderer.render(card.name(), card.deckId(), card.qrValue(), effects, description), card.createdAt(), card.updatedAt());
    }

    private static Specification<CardEntity> search(String query, String deckId) {
        return (root, criteria, builder) -> {
            var predicates = new ArrayList<Predicate>();
            if (query != null && !query.isBlank()) {
                var escaped = query.strip().toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
                var pattern = "%" + escaped + "%";
                predicates.add(builder.or(
                        builder.like(builder.lower(root.get("name")), pattern, '\\'),
                        builder.like(builder.lower(root.get("qrValue")), pattern, '\\')));
            }
            if (deckId != null && !deckId.isBlank()) {
                predicates.add(builder.equal(root.get("deckId"), deckId));
            }
            return builder.and(predicates.toArray(Predicate[]::new));
        };
    }
}
