package de.agiehl;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CardRepository extends JpaRepository<CardEntity, Long>, JpaSpecificationExecutor<CardEntity> {
    Optional<CardEntity> findByQrValue(String qrValue);

    @Query("select distinct effect.customName from CardEntity card join card.effects effect where effect.typeId = 'other' and effect.customName is not null and lower(effect.customName) like :query escape '\\' order by effect.customName")
    List<String> findCustomNames(@Param("query") String query);
}
