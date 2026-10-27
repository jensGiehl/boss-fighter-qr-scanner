package de.agiehl;

import java.util.Map;
import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final Map<String, String> fieldErrors;
    private final Long existingCardId;

    public ApiException(HttpStatus status, String message) {
        this(status, message, Map.of(), null);
    }

    public ApiException(HttpStatus status, String message, Map<String, String> fieldErrors, Long existingCardId) {
        super(message);
        this.status = status;
        this.fieldErrors = Map.copyOf(fieldErrors);
        this.existingCardId = existingCardId;
    }

    public HttpStatus status() { return status; }
    public Map<String, String> fieldErrors() { return fieldErrors; }
    public Long existingCardId() { return existingCardId; }
}
