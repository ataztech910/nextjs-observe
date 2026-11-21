# 11. RN: callbacks ещё не кадры — slide-A1

**Зачем:** ответить на вопрос о границах нативного источника. Сейчас это приложение, доступное из overview;
в основном маршруте RN-демонстрации нет. Это существенный разрыв с названием доклада.

## Что можно говорить по этому слайду

«Во время блокировки JS наш нативный callback-источник продолжал записываться.
Но запись callbacks не доказывает, что пользователь видел плавную анимацию.
На этом Simulator источник presentation/hitches оказался недоступен; эту часть мы оставили unavailable».

## Что показывать

Через `O` выбрать `slide-A1`: Simulator, callback evidence, явное presentation unavailable.
Не объявлять это графиком FPS и не показывать callback cadence как dropped frames.
Исходные анализы находятся в локальных папках `ios-cadence-1794441662289` и `ios-system-1794455821579`
под `performance-observability/reports/`; их нет внутри standalone deck.

## Доказательство и честное состояние RN

[Cadence](../../../docs/research/performance-observability/IOS_NATIVE_CADENCE.md),
[system source](../../../docs/research/performance-observability/IOS_SYSTEM_PROFILER_GATE.md).
Более поздний [Hermes workflow](../../../docs/research/performance-observability/HERMES_PROFILE_RESEARCH.md)
действительно локализовал `summarizeJobs` в Debug sampling; в этой карточке его ещё нет.
[Loaded interaction study](../../../docs/research/performance-observability/RN_LOADED_INPUT_RESEARCH.md)
сохранил равную работу и меньшие process medians, но нарушил predeclared validity gate: вывод inconclusive.
Нельзя превращать это в «мы исправили RN UX».

**Решение:** оставить как ограниченный ответ на вопрос. Создать основной RN-кейс из принятого before/after
и реального профилирования ещё предстоит. Добавление этого приложения в main само по себе пробел не закрывает.
