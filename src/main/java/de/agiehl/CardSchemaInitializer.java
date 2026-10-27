package de.agiehl;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.jdbc.autoconfigure.ApplicationDataSourceScriptDatabaseInitializer;
import org.springframework.boot.sql.autoconfigure.init.SqlInitializationProperties;
import org.springframework.stereotype.Component;

@Component
@EnableConfigurationProperties(SqlInitializationProperties.class)
public class CardSchemaInitializer extends ApplicationDataSourceScriptDatabaseInitializer {
    public CardSchemaInitializer(DataSource dataSource, SqlInitializationProperties properties) {
        super(dataSource, properties);
    }

    @Override
    public boolean initializeDatabase() {
        var initialized = super.initializeDatabase();
        try (var connection = getDataSource().getConnection()) {
            if (!hasColumn(connection, "CARDS", "CARD_NUMBER")) {
                return initialized;
            }
            try (var statement = connection.createStatement()) {
                if (hasColumn(connection, "CARD_DESCRIPTION", "VARIABLE_NAME")) {
                    statement.executeUpdate("""
                            UPDATE card_description
                            SET kind = 'text',
                                token_text = (SELECT card_number FROM cards WHERE cards.id = card_description.card_id),
                                variable_name = NULL
                            WHERE kind = 'variable' AND variable_name = 'cardNumber'
                            """);
                }
                statement.executeUpdate("ALTER TABLE cards DROP COLUMN card_number");
            }
            return true;
        } catch (SQLException exception) {
            throw new IllegalStateException("Could not migrate legacy card numbers", exception);
        }
    }

    private static boolean hasColumn(Connection connection, String table, String column) throws SQLException {
        try (var columns = connection.getMetaData().getColumns(connection.getCatalog(), connection.getSchema(), table, column)) {
            return columns.next();
        }
    }
}
