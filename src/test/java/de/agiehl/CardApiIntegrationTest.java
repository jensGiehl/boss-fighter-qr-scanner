package de.agiehl;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:card-api-tests;DB_CLOSE_DELAY=-1",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class CardApiIntegrationTest {
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final JsonMapper json = JsonMapper.builder().build();

    @Autowired
    private Environment environment;
    @Autowired
    private CardRepository repository;

    @BeforeEach
    void resetDatabase() {
        repository.deleteAll();
    }

    @Test
    void defaultsMissingSourcesToBaseGame() throws Exception {
        var created = parse(send("POST", "/api/cards", card("source://default", "Bestehender Client")));
        assertThat(created.path("sourceId").asString()).isEqualTo("base-game");
        assertThat(created.has("cardNumber")).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"base-game", "promo", "jungle-fever"})
    void persistsListsAndUpdatesCardSources(String sourceId) throws Exception {
        var body = card("source://" + sourceId, "Herkunft");
        body.put("sourceId", sourceId);
        var response = send("POST", "/api/cards", body);
        assertThat(response.statusCode()).isEqualTo(201);
        var created = parse(response);
        assertThat(created.path("sourceId").asString()).isEqualTo(sourceId);
        var path = "/api/cards/" + created.path("id").asLong();
        assertThat(parse(send("GET", path, null)).path("sourceId").asString()).isEqualTo(sourceId);
        assertThat(parse(send("GET", "/api/cards", null)).path("content").get(0).path("sourceId").asString()).isEqualTo(sourceId);
        body.put("version", created.path("version").asLong());
        body.put("sourceId", "promo".equals(sourceId) ? "jungle-fever" : "promo");
        var updated = send("PUT", path, body);
        assertThat(updated.statusCode()).isEqualTo(200);
        assertThat(parse(send("GET", path, null)).path("sourceId").asString()).isEqualTo(body.get("sourceId"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "unknown", "BASE_GAME"})
    void rejectsUnknownSourcesOnCreateAndUpdate(String sourceId) throws Exception {
        var body = card("source://invalid", "Herkunft");
        var created = parse(send("POST", "/api/cards", body));
        body.put("sourceId", sourceId);
        body.put("qrValue", "source://rejected");
        var rejected = send("POST", "/api/cards", body);
        assertThat(rejected.statusCode()).isEqualTo(400);
        assertThat(parse(rejected).path("fieldErrors").has("sourceId")).isTrue();
        body.put("version", created.path("version").asLong());
        var path = "/api/cards/" + created.path("id").asLong();
        assertThat(send("PUT", path, body).statusCode()).isEqualTo(400);
        assertThat(parse(send("GET", path, null)).path("sourceId").asString()).isEqualTo("base-game");
        assertThat(repository.count()).isEqualTo(1);
    }

    @Test
    void exposesCatalogHealthAndLocalWebjars() throws Exception {
        var catalog = parse(send("GET", "/api/catalog", null));
        assertThat(catalog.path("decks").size()).isEqualTo(23);
        assertThat(catalog.path("decks").get(0).path("name").asString()).isEqualTo("Druide");
        var dryad = catalogItem(catalog.path("decks"), "dryad");
        assertThat(dryad.path("name").asString()).isEqualTo("Dryade");
        assertThat(dryad.path("icon").asString()).isEqualTo("dryad");
        var goblin = catalogItem(catalog.path("decks"), "goblin");
        assertThat(goblin.path("name").asString()).isEqualTo("Goblin");
        assertThat(goblin.path("icon").asString()).isEqualTo("goblin");
        var paladin = catalogItem(catalog.path("decks"), "paladin");
        assertThat(paladin.path("name").asString()).isEqualTo("Paladin");
        assertThat(paladin.path("icon").asString()).isEqualTo("paladin");
        assertThat(catalogItem(catalog.path("decks"), "items").path("name").asString()).isEqualTo("Gegenstände");
        for (var number = 1; number <= 10; number++) {
            var deck = catalogItem(catalog.path("decks"), "loot-" + number);
            assertThat(deck.path("name").asString()).isEqualTo("Beute " + number);
            assertThat(deck.path("icon").asString()).isEqualTo("loot:" + number);
        }
        assertThat(catalog.path("effectTypes").size()).isEqualTo(10);
        assertThat(catalog.path("symbols").size()).isEqualTo(9);
        assertThat(parse(send("GET", "/actuator/health", null)).path("status").asString()).isEqualTo("UP");
        assertThat(send("GET", "/webjars/bootstrap/5.3.8/css/bootstrap.min.css", null).statusCode()).isEqualTo(200);
        assertThat(send("GET", "/webjars/jsqr/1.4.0/dist/jsQR.js", null).statusCode()).isEqualTo(200);
        assertThat(send("GET", "/icons/loot.svg", null).statusCode()).isEqualTo(200);
        assertThat(send("GET", "/icons/dryad.svg", null).statusCode()).isEqualTo(200);
        assertThat(send("GET", "/icons/goblin.svg", null).statusCode()).isEqualTo(200);
        assertThat(send("GET", "/icons/paladin.svg", null).statusCode()).isEqualTo(200);
    }

    @Test
    void capturesItemsAndFiltersThemByDeck() throws Exception {
        var body = card("items://ring", "Zauberring");
        body.put("deckId", "items");
        body.put("description", List.of(new CardModels.DescriptionToken("variable", null, null, null, "deckName")));
        var createdResponse = send("POST", "/api/cards", body);
        assertThat(createdResponse.statusCode()).isEqualTo(201);
        var created = parse(createdResponse);
        assertThat(created.path("deckId").asString()).isEqualTo("items");
        assertThat(created.path("descriptionText").asString()).isEqualTo("Gegenstände");
        var filtered = parse(send("GET", "/api/cards?deckId=items", null));
        assertThat(filtered.path("totalElements").asLong()).isEqualTo(1);
        assertThat(filtered.path("content").get(0).path("id")).isEqualTo(created.path("id"));
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 10})
    void persistsUpdatesAndFiltersLootDecksWithDynamicDeckNames(int number) throws Exception {
        var body = card("loot://" + number, "Goldschatz");
        body.put("deckId", "loot-" + number);
        body.put("description", List.of(new CardModels.DescriptionToken("variable", null, null, null, "deckName")));
        var response = send("POST", "/api/cards", body);
        assertThat(response.statusCode()).isEqualTo(201);
        var created = parse(response);
        assertThat(created.path("deckId").asString()).isEqualTo("loot-" + number);
        assertThat(created.path("descriptionText").asString()).isEqualTo("Beute " + number);
        var path = "/api/cards/" + created.path("id").asLong();
        assertThat(parse(send("GET", path, null)).path("deckId").asString()).isEqualTo("loot-" + number);
        var filtered = parse(send("GET", "/api/cards?deckId=loot-" + number, null));
        assertThat(filtered.path("totalElements").asLong()).isEqualTo(1);
        assertThat(filtered.path("content").get(0).path("id")).isEqualTo(created.path("id"));
        var updatedNumber = number == 1 ? 10 : 1;
        body.put("version", created.path("version").asLong());
        body.put("deckId", "loot-" + updatedNumber);
        assertThat(send("PUT", path, body).statusCode()).isEqualTo(200);
        var updated = parse(send("GET", path, null));
        assertThat(updated.path("deckId").asString()).isEqualTo("loot-" + updatedNumber);
        assertThat(updated.path("descriptionText").asString()).isEqualTo("Beute " + updatedNumber);
        assertThat(parse(send("GET", "/api/cards?deckId=loot-" + number, null)).path("totalElements").asLong()).isZero();
        assertThat(parse(send("GET", "/api/cards?deckId=loot-" + updatedNumber, null)).path("totalElements").asLong()).isEqualTo(1);
    }

    @Test
    void exposesNewEffectLabelsIconsAndValueRequirements() throws Exception {
        var catalog = parse(send("GET", "/api/catalog", null));
        var expected = Map.of(
                "draw", List.of("Karten ziehen", "🃏", "Karten"),
                "heal", List.of("Heilen", "❤️", "Heilung"),
                "poison", List.of("Gift zufügen", "💧", "Gift"),
                "direct-damage", List.of("Direkter Schaden", "💔", "Schaden"));
        for (var entry : expected.entrySet()) {
            var type = catalogItem(catalog.path("effectTypes"), entry.getKey());
            assertThat(type.path("name").asString()).isEqualTo(entry.getValue().get(0));
            assertThat(type.path("icon").asString()).isEqualTo(entry.getValue().get(1));
            assertThat(type.path("valueLabel").asString()).isEqualTo(entry.getValue().get(2));
            assertThat(type.path("hasValue").asBoolean()).isTrue();
        }
        var action = catalogItem(catalog.path("effectTypes"), "extra-action");
        assertThat(action.path("name").asString()).isEqualTo("Weitere Aktion");
        assertThat(action.path("icon").asString()).isEqualTo("⚡");
        assertThat(action.path("hasValue").asBoolean()).isFalse();
        for (var typeId : List.of("melee", "melee-boost", "ranged", "ranged-boost", "other")) {
            assertThat(catalogItem(catalog.path("effectTypes"), typeId).path("hasValue").asBoolean()).isTrue();
        }
        for (var symbol : Map.of("card-draw", "🃏", "poison", "💧", "broken-heart", "💔").entrySet()) {
            assertThat(catalogItem(catalog.path("symbols"), symbol.getKey()).path("icon").asString()).isEqualTo(symbol.getValue());
        }
    }

    @Test
    void persistsAndUpdatesAllNewEffectsWithStructuredDescriptions() throws Exception {
        var draw = effect("draw", 2, null);
        var heal = effect("heal", 3, null);
        var action = effect("extra-action", null, null);
        var poison = effect("poison", 4, null);
        var damage = effect("direct-damage", 5, null);
        var effects = List.of(draw, heal, action, poison, damage);
        var description = List.of(effectToken(draw), text(" "), symbol("card-draw"), text(" / "),
                effectToken(heal), text(" "), symbol("heart"), text(" / "),
                effectToken(action), text(" "), symbol("lightning"), text(" / "),
                effectToken(poison), text(" "), symbol("poison"), text(" / "),
                effectToken(damage), text(" "), symbol("broken-heart"));
        var body = card("card://new-effects", "Neue Effekte");
        body.put("effects", effects);
        body.put("description", description);
        var response = send("POST", "/api/cards", body);
        assertThat(response.statusCode()).isEqualTo(201);
        var created = parse(response);
        var originalText = "Karten ziehen 2 🃏 / Heilen 3 ❤️ / Weitere Aktion ⚡ / Gift zufügen 4 💧 / Direkter Schaden 5 💔";
        assertThat(created.path("descriptionText").asString()).isEqualTo(originalText);
        var path = "/api/cards/" + created.path("id").asLong();
        var loaded = parse(send("GET", path, null));
        assertThat(loaded.path("effects")).isEqualTo(json.readTree(json.writeValueAsString(effects)));
        assertThat(loaded.path("description")).isEqualTo(json.readTree(json.writeValueAsString(description)));
        assertThat(loaded.path("descriptionText").asString()).isEqualTo(originalText);
        var changedEffects = effects.stream().map(effect -> new CardModels.Effect(effect.id(), effect.typeId(),
                effect.value() == null ? null : effect.value() + 5, effect.customName())).toList();
        body.put("version", loaded.path("version").asLong());
        body.put("effects", changedEffects);
        var updatedResponse = send("PUT", path, body);
        assertThat(updatedResponse.statusCode()).isEqualTo(200);
        var updated = parse(updatedResponse);
        var updatedText = "Karten ziehen 7 🃏 / Heilen 8 ❤️ / Weitere Aktion ⚡ / Gift zufügen 9 💧 / Direkter Schaden 10 💔";
        assertThat(updated.path("descriptionText").asString()).isEqualTo(updatedText);
        var reloaded = parse(send("GET", path, null));
        assertThat(reloaded.path("effects")).isEqualTo(json.readTree(json.writeValueAsString(changedEffects)));
        assertThat(reloaded.path("description")).isEqualTo(loaded.path("description"));
        assertThat(reloaded.path("descriptionText").asString()).isEqualTo(updatedText);
    }

    @ParameterizedTest
    @ValueSource(strings = {"melee", "melee-boost", "ranged", "ranged-boost", "draw", "heal", "poison", "direct-damage"})
    void rejectsMissingValuesForNumericEffects(String typeId) throws Exception {
        var body = card("invalid://missing-value/" + typeId, "Fehlender Wert");
        body.put("effects", List.of(effect(typeId, null, null)));
        var response = send("POST", "/api/cards", body);
        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(parse(response).path("fieldErrors").has("effects[0].value")).isTrue();
        assertThat(repository.count()).isZero();
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, -1})
    void rejectsValuesForAdditionalActions(int value) throws Exception {
        var body = card("invalid://action-value/" + value, "Unerwarteter Wert");
        body.put("effects", List.of(effect("extra-action", value, null)));
        var response = send("POST", "/api/cards", body);
        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(parse(response).path("fieldErrors").has("effects[0].value")).isTrue();
        assertThat(repository.count()).isZero();
    }

    @Test
    void persistsOrderedStructuredDescriptionAndUpdatesEffectVariables() throws Exception {
        var melee = effect("melee", 3, null);
        var other = effect("other", null, "POISON_EXPLOSION");
        var body = card("card://roundtrip", "Waldwächter");
        body.put("effects", List.of(melee, other));
        body.put("description", List.of(text("Schlag: "), effectToken(melee), text(" / "),
                new CardModels.DescriptionToken("variable", null, null, null, "name"), text(" "),
                new CardModels.DescriptionToken("symbol", null, "star", null, null)));
        var createdResponse = send("POST", "/api/cards", body);
        assertThat(createdResponse.statusCode()).isEqualTo(201);
        var created = parse(createdResponse);
        assertThat(created.path("descriptionText").asString()).isEqualTo("Schlag: Nahkampf 3 / Waldwächter ★");
        var id = created.path("id").asLong();
        var loaded = parse(send("GET", "/api/cards/" + id, null));
        assertThat(loaded.path("effects").get(0).path("id").asString()).isEqualTo(melee.id());
        assertThat(loaded.path("description").get(1).path("effectId").asString()).isEqualTo(melee.id());
        body.put("version", loaded.path("version").asLong());
        body.put("name", "Feuerwächter");
        body.put("effects", List.of(other, new CardModels.Effect(melee.id(), "melee-boost", 7, null)));
        var updatedResponse = send("PUT", "/api/cards/" + id, body);
        assertThat(updatedResponse.statusCode()).isEqualTo(200);
        var updated = parse(updatedResponse);
        assertThat(updated.path("version").asLong()).isGreaterThan(loaded.path("version").asLong());
        assertThat(updated.path("descriptionText").asString()).isEqualTo("Schlag: Nahkampf-Verstärkung 7 / Feuerwächter ★");
        var reloaded = parse(send("GET", "/api/cards/" + id, null));
        assertThat(reloaded.path("effects").get(0).path("id").asString()).isEqualTo(other.id());
        assertThat(reloaded.path("descriptionText").asString()).isEqualTo(updated.path("descriptionText").asString());
    }

    @Test
    void rejectsDuplicatesAndStaleVersionsWithoutLosingSavedData() throws Exception {
        var original = card("unique://qr", "Original");
        var created = parse(send("POST", "/api/cards", original));
        var duplicateResponse = send("POST", "/api/cards", card("unique://qr", "Duplikat"));
        assertThat(duplicateResponse.statusCode()).isEqualTo(409);
        assertThat(parse(duplicateResponse).path("existingCardId").asLong()).isEqualTo(created.path("id").asLong());
        original.put("version", created.path("version").asLong());
        original.put("name", "Aktualisiert");
        assertThat(send("PUT", "/api/cards/" + created.path("id").asLong(), original).statusCode()).isEqualTo(200);
        original.put("name", "Veraltete Änderung");
        assertThat(send("PUT", "/api/cards/" + created.path("id").asLong(), original).statusCode()).isEqualTo(409);
        assertThat(parse(send("GET", "/api/cards/" + created.path("id").asLong(), null)).path("name").asString()).isEqualTo("Aktualisiert");
    }

    @Test
    void concurrentSavesCannotCreateTheSameQrTwice() throws Exception {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = CompletableFuture.supplyAsync(() -> uncheckedSend(card("race://qr", "Erster")), executor);
            var second = CompletableFuture.supplyAsync(() -> uncheckedSend(card("race://qr", "Zweiter")), executor);
            var statuses = List.of(first.join().statusCode(), second.join().statusCode());
            assertThat(statuses).containsExactlyInAnyOrder(201, 409);
            assertThat(repository.count()).isEqualTo(1);
        }
    }

    @Test
    void concurrentUpdatesPreserveOneVersion() throws Exception {
        var body = card("race://update", "Original");
        var created = parse(send("POST", "/api/cards", body));
        var firstBody = new HashMap<>(body);
        firstBody.put("version", created.path("version").asLong());
        firstBody.put("name", "Erste Änderung");
        var secondBody = new HashMap<>(firstBody);
        secondBody.put("name", "Zweite Änderung");
        var path = "/api/cards/" + created.path("id").asLong();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = CompletableFuture.supplyAsync(() -> uncheckedSend("PUT", path, firstBody), executor);
            var second = CompletableFuture.supplyAsync(() -> uncheckedSend("PUT", path, secondBody), executor);
            assertThat(List.of(first.join().statusCode(), second.join().statusCode())).containsExactlyInAnyOrder(200, 409);
            assertThat(parse(send("GET", path, null)).path("name").asString()).isIn("Erste Änderung", "Zweite Änderung");
        }
    }

    @Test
    void validatesUnicodeLimitsStructuredReferencesAndConstantNames() throws Exception {
        var unicode = card("unicode://qr", "🦉".repeat(50));
        assertThat(send("POST", "/api/cards", unicode).statusCode()).isEqualTo(201);
        unicode.put("name", "🦉".repeat(51));
        assertThat(parse(send("POST", "/api/cards", unicode)).path("fieldErrors").has("name")).isTrue();
        var invalid = card("invalid://qr", "Name");
        invalid.put("deckId", null);
        invalid.put("effects", List.of(effect("other", null, "poison explosion")));
        invalid.put("description", List.of(new CardModels.DescriptionToken("effect", null, null, UUID.randomUUID().toString(), null)));
        var errorResponse = send("POST", "/api/cards", invalid);
        assertThat(errorResponse.statusCode()).isEqualTo(400);
        var errors = parse(errorResponse).path("fieldErrors");
        assertThat(errors.has("deckId")).isTrue();
        assertThat(errors.has("effects[0].customName")).isTrue();
        assertThat(errors.has("description[0]")).isTrue();
        invalid = card("expanded://qr", "Name");
        invalid.put("description", List.of(text("a".repeat(396)), new CardModels.DescriptionToken("variable", null, null, null, "name")));
        assertThat(send("POST", "/api/cards", invalid).statusCode()).isEqualTo(201);
        invalid.put("qrValue", "expanded://too-long");
        invalid.put("name", "Names");
        assertThat(parse(send("POST", "/api/cards", invalid)).path("fieldErrors").has("description")).isTrue();
    }

    @Test
    void searchesFiltersPaginatesAndSuggestsDistinctConstantNames() throws Exception {
        var first = card("list://first", "Alpha_1");
        first.put("effects", List.of(effect("other", 2, "POISON_EXPLOSION")));
        assertThat(send("POST", "/api/cards", first).statusCode()).isEqualTo(201);
        var second = card("list://second", "AlphaX1");
        second.put("deckId", "mage");
        second.put("effects", List.of(effect("other", null, "POISON_EXPLOSION"), effect("other", 4, "POWER_SHIELD")));
        assertThat(send("POST", "/api/cards", second).statusCode()).isEqualTo(201);
        assertThat(parse(send("GET", "/api/cards?q=Alpha_1", null)).path("totalElements").asLong()).isEqualTo(1);
        assertThat(parse(send("GET", "/api/cards?deckId=mage", null)).path("totalElements").asLong()).isEqualTo(1);
        var page = parse(send("GET", "/api/cards?size=1&page=1", null));
        assertThat(page.path("content").size()).isEqualTo(1);
        assertThat(page.path("totalPages").asInt()).isEqualTo(2);
        assertThat(page.path("totalElements").asLong()).isEqualTo(2);
        var names = parse(send("GET", "/api/effect-names?q=poison_", null));
        assertThat(names.size()).isEqualTo(1);
        assertThat(names.get(0).asString()).isEqualTo("POISON_EXPLOSION");
        assertThat(send("GET", "/api/cards?size=101", null).statusCode()).isEqualTo(400);
        assertThat(send("GET", "/api/cards/99999", null).statusCode()).isEqualTo(404);
    }

    @Test
    void treatsDescriptionTextAsDataAndRejectsMalformedNumbers() throws Exception {
        var body = card("text://html", "Name");
        body.put("description", List.of(text("<img src=x onerror=alert(1)>")));
        var created = parse(send("POST", "/api/cards", body));
        assertThat(created.path("descriptionText").asString()).isEqualTo("<img src=x onerror=alert(1)>");
        body.put("qrValue", "number://fraction");
        body.put("effects", List.of(Map.of("id", UUID.randomUUID().toString(), "typeId", "melee", "value", "no-number")));
        assertThat(send("POST", "/api/cards", body).statusCode()).isEqualTo(400);
        body.put("effects", List.of(Map.of("id", UUID.randomUUID().toString(), "typeId", "melee", "value", 3.5)));
        assertThat(send("POST", "/api/cards", body).statusCode()).isEqualTo(400);
    }

    private Map<String, Object> card(String qrValue, String name) {
        var body = new HashMap<String, Object>();
        body.put("qrValue", qrValue);
        body.put("name", name);
        body.put("deckId", "druid");
        body.put("effects", List.of(effect("melee", 3, null)));
        body.put("description", List.of());
        return body;
    }

    private static CardModels.Effect effect(String type, Integer value, String customName) {
        return new CardModels.Effect(UUID.randomUUID().toString(), type, value, customName);
    }

    private static CardModels.DescriptionToken text(String value) {
        return new CardModels.DescriptionToken("text", value, null, null, null);
    }

    private static CardModels.DescriptionToken effectToken(CardModels.Effect effect) {
        return new CardModels.DescriptionToken("effect", null, null, effect.id(), null);
    }

    private static CardModels.DescriptionToken symbol(String symbolId) {
        return new CardModels.DescriptionToken("symbol", null, symbolId, null, null);
    }

    private static JsonNode catalogItem(JsonNode items, String id) {
        for (var item : items) {
            if (id.equals(item.path("id").asString())) {
                return item;
            }
        }
        throw new IllegalArgumentException("Missing catalog item: " + id);
    }

    private HttpResponse<String> uncheckedSend(Map<String, Object> body) {
        return uncheckedSend("POST", "/api/cards", body);
    }

    private HttpResponse<String> uncheckedSend(String method, String path, Map<String, Object> body) {
        try {
            return send(method, path, body);
        } catch (IOException | InterruptedException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private HttpResponse<String> send(String method, String path, Map<String, Object> body) throws IOException, InterruptedException {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + environment.getRequiredProperty("local.server.port") + path))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode parse(HttpResponse<String> response) {
        return json.readTree(response.body());
    }
}
