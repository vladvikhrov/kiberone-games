# План и статус

Этапы маркетплейса из [ADR-0002, раздел 7](adr/0002-marketplace.md) и [ADR-0003, раздел 8](adr/0003-vitrina.md). Каждый этап закрывается отчётом и проверкой на Windows.

| Этап | Что | Linux | Windows и класс | Постановка | Отчёт |
| --- | --- | --- | --- | --- | --- |
| В0 | Витрина K1 без сети: обложки, режимы, оценки | готово | не проверено | [etap-v0-vitrina.md](tasks/etap-v0-vitrina.md) | [otchet-v0.md](tasks/otchet-v0.md) |
| М1 | Ключ школы, публикация, подписанный каталог, программа тьютора | готово | не проверено | [etap-m1.md](tasks/etap-m1.md) | [otchet-m1.md](tasks/otchet-m1.md) |
| М2 | Раздача по сети, витрина по каталогу школы | готово | не проверено | [etap-m2.md](tasks/etap-m2.md) | [otchet-m2.md](tasks/otchet-m2.md) |
| М3 | Нагрузка на Wi-Fi: слоты, предел скорости, докачка | готово | не проверено | [etap-m3.md](tasks/etap-m3.md) | [otchet-m3.md](tasks/otchet-m3.md) |
| М4 | Оценки по сети | готово | не проверено | [etap-m4.md](tasks/etap-m4.md) | [otchet-m4.md](tasks/otchet-m4.md) |
| М5 | Установщики, документация, установка Кириллом, пилот | готово, кроме сборки установщиков | идёт | [etap-m5.md](tasks/etap-m5.md) | [otchet-m5.md](tasks/otchet-m5.md) |

Задания для проверки на Windows: [`windows-v0.md`](tasks/windows-v0.md), [`windows-m1.md`](tasks/windows-m1.md) … [`windows-m4.md`](tasks/windows-m4.md), [`windows-m5.md`](tasks/windows-m5.md). Пилот: [`pilot-m5.md`](tasks/pilot-m5.md), установка Кириллом: [`kirill-ustanovka.md`](tasks/kirill-ustanovka.md).

## Дальше

После пилота — разбор итогов и решения по [ADR-0002, раздел 9](adr/0002-marketplace.md):

- несколько школ на одном ноутбуке тьютора или одна школа на нескольких тьюторах;
- мультиплеер: только задел, что нужно от платформы;
- идеи Кирилла: конструктор игр и что для него нужно от формата `.kibgames`.

Не планируются: автообновление, подпись кода Windows, рейтинг учеников с никами.
