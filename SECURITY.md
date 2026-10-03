# Security Policy

## Supported versions

While the project is in v0.x, only the latest release receives security fixes.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report them privately through **GitHub Security Advisories**: open the repository's
**Security** tab and choose **Report a vulnerability**. If that is unavailable, contact the
maintainers via GitHub and ask for a private channel.

Please include a description, steps to reproduce, affected version and OS, and the impact.
We aim to acknowledge reports within 7 days and will keep you informed while a fix is prepared.

## Scope notes

EzyChat Lite stores WhatsApp session credentials and customer messages locally. Issues that
expose these (authentication bypass, setup takeover, path traversal in media serving, tunnel
exposure, service install scripts) are especially relevant.
