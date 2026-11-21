# 12. Сценарий упал, архив сохранился — slide-A2

**Зачем:** ответить на вопрос об автоматизации и сохранении evidence при ошибках.
Только Q&A в текущем плане; отдельного времени сверх 30 минут нет.

## Что говорить

«Maestro нажимает на элементы приложения и проверяет результат. В одном запуске assertion верный,
в другом мы намеренно сделали его неверным. Второй сценарий failed, но телеметрия сохранилась и архив
finalized. Состояние сценария и состояние архива — независимые вещи».

## Что показывать

Из overview открыть `slide-A2`, сопоставить passed/finalized и failed/finalized.
При подробном вопросе открыть исходные JUnit и отчёты с IDs
`maestro-1794559097407-1a14dc` и `maestro-1794559119640-609fd2`.
[Demo plan](../../../docs/research/performance-observability/CONFERENCE_DEMO_PLAN.md) содержит запуск viewers;
локальные исходники находятся под `performance-observability/reports/<ID>/`.

## Доказательство и ограничения

[Maestro gate](../../../docs/research/performance-observability/MAESTRO_GATE.md).
Показана функциональная интеграция на Simulator. Runner action time не является CPU, touch latency или frame time.
Намеренно неверный completion assertion проверяет функциональный сбой, **не performance regression**.

**Решение:** сохранить для Q&A. Эта сцена объясняет, куда складывать результаты Maestro,
но не заменяет RN before/after и CI-проверку обоснованного performance budget.
