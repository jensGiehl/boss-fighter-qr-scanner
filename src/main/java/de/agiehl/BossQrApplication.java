package de.agiehl;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(CatalogProperties.class)
public class BossQrApplication {
    public static void main(String[] args) {
        SpringApplication.run(BossQrApplication.class, args);
    }
}
