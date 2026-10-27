FROM maven:3.9.16-eclipse-temurin-25 AS maven-tools

FROM eclipse-temurin:27-jdk AS build
ENV MAVEN_HOME=/usr/share/maven
ENV PATH="${MAVEN_HOME}/bin:${PATH}"
WORKDIR /workspace
COPY --from=maven-tools /usr/share/maven /usr/share/maven
COPY pom.xml ./
RUN mvn --batch-mode --no-transfer-progress dependency:go-offline
COPY src ./src
RUN mvn --batch-mode --no-transfer-progress verify

FROM eclipse-temurin:27-jre AS runtime
WORKDIR /app
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app \
    && mkdir -p /app/data /app/config \
    && chown -R app:app /app
COPY --from=build --chown=app:app /workspace/target/bossqr-card-scanner-*.jar /app/app.jar
ENV DB_PATH=/app/data/cards
ENV SERVER_PORT=8080
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
