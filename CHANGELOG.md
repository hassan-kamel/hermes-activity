# Changelog

## 0.1.1

- Fixed the 12-month Activity page failing when its full JSON response exceeded Hermes Desktop's `cli.exec` output limit. The desktop request now trims breakdowns to the rows the page displays; standalone CLI output remains complete.
