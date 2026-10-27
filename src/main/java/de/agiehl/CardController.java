package de.agiehl;

import java.net.URI;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class CardController {
    private final CardService cards;
    private final CatalogService catalog;

    public CardController(CardService cards, CatalogService catalog) {
        this.cards = cards;
        this.catalog = catalog;
    }

    @GetMapping("/catalog")
    public CatalogProperties catalog() {
        return catalog.catalog();
    }

    @GetMapping("/cards")
    public CardModels.CardPage cards(@RequestParam(defaultValue = "") String q,
                                    @RequestParam(defaultValue = "") String deckId,
                                    @RequestParam(defaultValue = "0") int page,
                                    @RequestParam(defaultValue = "20") int size) {
        return cards.list(q, deckId, page, size);
    }

    @GetMapping("/cards/{id}")
    public CardModels.CardResponse card(@PathVariable long id) {
        return cards.get(id);
    }

    @PostMapping("/cards")
    public ResponseEntity<CardModels.CardResponse> create(@RequestBody CardModels.CardRequest request) {
        var card = cards.create(request);
        return ResponseEntity.created(URI.create("/api/cards/" + card.id())).body(card);
    }

    @PutMapping("/cards/{id}")
    public CardModels.CardResponse update(@PathVariable long id, @RequestBody CardModels.CardRequest request) {
        return cards.update(id, request);
    }

    @GetMapping("/effect-names")
    public List<String> customEffectNames(@RequestParam(defaultValue = "") String q) {
        return cards.customNames(q);
    }
}
