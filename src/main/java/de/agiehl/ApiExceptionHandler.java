package de.agiehl;

import java.util.Map;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiExceptionHandler {
    private final CardRepository repository;

    public ApiExceptionHandler(CardRepository repository) {
        this.repository = repository;
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<CardModels.ApiError> handle(ApiException exception) {
        return ResponseEntity.status(exception.status()).body(new CardModels.ApiError(exception.getMessage(), exception.fieldErrors(), exception.existingCardId()));
    }

    @ExceptionHandler(DuplicateQrException.class)
    public ResponseEntity<CardModels.ApiError> duplicate(DuplicateQrException exception) {
        var existingId = repository.findByQrValue(exception.qrValue()).map(CardEntity::id).orElse(null);
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new CardModels.ApiError(exception.getMessage(), Map.of("qrValue", "QR-Code bereits vorhanden."), existingId));
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<CardModels.ApiError> concurrentUpdate(OptimisticLockingFailureException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new CardModels.ApiError("Diese Karte wurde inzwischen geändert. Bitte neu laden und die Änderungen erneut eintragen.", Map.of(), null));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    public ResponseEntity<CardModels.ApiError> invalidRequest(Exception exception) {
        return ResponseEntity.badRequest().body(new CardModels.ApiError("Die Anfrage enthält ungültige Daten oder einen ungültigen Zahlenwert.", Map.of(), null));
    }
}
