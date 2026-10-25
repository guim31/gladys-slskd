# slskd

Verfolge [slskd](https://github.com/slskd/slskd) in Gladys: den modernen Soulseek-Client, der auf
einem NAS oder Heimserver läuft (Docker, Unraid…), mit Weboberfläche und API. Die Integration
liest die lokale API von slskd: Geschwindigkeit und Downloads erscheinen im Dashboard, und Gladys
kann dir sagen, wann eine Datei heruntergeladen ist, wann ein Download fehlgeschlagen ist, wann
alles fertig ist oder wann slskd das Soulseek-Netzwerk verloren hat.

Die Integration liest nur und sucht, lädt, teilt oder sendet nie etwas im Soulseek-Netzwerk: Das bleibt deine Sache, in slskd. Der einzige Befehl der Integration, standardmäßig aus, entfernt die fertigen
Downloads aus der Liste von slskd (die Dateien bleiben auf der Platte).

Getestet mit einem echten slskd 0.26.2 (zwei Instanzen, die freie Testdateien im
Soulseek-Netzwerk austauschen), noch nicht in einem echten Gladys: Rückmeldungen gern auf
[GitHub](https://github.com/guim31/gladys-slskd/issues).

## Voraussetzungen

- Gladys 5.1.0 oder neuer.
- slskd vom Gladys-Server aus erreichbar (gleiches Netzwerk), über seinen HTTP-Port (standardmäßig 5030) oder seinen HTTPS-Port (5031).
- Ein **API-Schlüssel** von slskd. Füge einen in `slskd.yml` hinzu und starte slskd neu:

  ```yaml
  web:
    authentication:
      api_keys:
        gladys:
          key: <16 bis 255 Zeichen deiner Wahl>
          role: readonly # readwrite, wenn du das Aufräumen erlaubst
          cidr: 192.168.1.0/24 # das Netzwerk von Gladys
  ```

  Oder mit der Umgebungsvariablen `SLSKD_API_KEY` (der Hauptschlüssel von slskd). Ohne
  Authentifizierung in slskd (`SLSKD_NO_AUTH` oder `web.authentication.disabled: true`) lässt du
  den Schlüssel leer.

## Konfiguration

- **Adresse**: die IP-Adresse oder der Name, mit Port: `192.168.1.10:5030`. Ohne Port wird 5030
  ergänzt. Schreib `https://` für HTTPS, und den Pfad, wenn slskd unter einer `url_base` oder
  hinter einem Reverse Proxy läuft (`https://example.com/slskd`).
- **API-Schlüssel**: der Schlüssel aus `slskd.yml`.
- **Name**: der Name des Geräts in Gladys (leer: slskd gefolgt von der Adresse).
- **Selbstsignierte Zertifikate akzeptieren**: für ein slskd über HTTPS mit eigenem Zertifikat.
- **Aktualisierungsintervall**: wie oft slskd gelesen wird, 10 Sekunden bis 5 Minuten
  (standardmäßig 30 Sekunden). Es ist auch die Verzögerung der Auslöser. Eine Lesung kostet drei
  Aufrufe der lokalen API, nichts im Soulseek-Netzwerk.
- **Aufräumen fertiger Downloads erlauben**: Erlaubt einer Szene oder dem Widget, die Liste der
  fertigen Downloads zu leeren. Standardmäßig aus.
- **Sprache der Funktionsnamen**: die Namen der Funktionen beim Hinzufügen des Geräts und die
  Statustexte.

**Verbindung testen** liest slskd sofort und meldet, was es findet: Version, Soulseek-Netzwerk,
Downloads.

Füge dann unter **Erkennung** das Gerät hinzu.

## Geräte

Ein Gerät, nur lesend:

| Funktion                  | Inhalt                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| Download-Geschwindigkeit  | KB/s, die laufenden Downloads                                                                     |
| Upload-Geschwindigkeit    | KB/s, was andere Soulseek-Benutzer bei dir herunterladen                                          |
| Laufende Downloads        | Dateien, die gerade übertragen werden                                                             |
| Wartende Downloads        | angefragte Dateien, in einer Warteschlange (deiner oder der des Partners) oder zwischen Versuchen |
| Abgeschlossene Downloads  | heruntergeladene Dateien in der Liste von slskd (bis zum Aufräumen)                               |
| Fehlgeschlagene Downloads | vom Partner abgelehnte, fehlerhafte oder abgelaufene Dateien in der Liste von slskd               |
| Laufende Uploads          | Dateien, die andere Benutzer gerade bei dir herunterladen                                         |
| Status                    | Lädt herunter, Wartet, Leerlauf, Soulseek getrennt oder Nicht erreichbar                          |
| Letzter Download          | Name der zuletzt fertigen Datei                                                                   |

Das Gerät zeigt das Abzeichen **nicht erreichbar**, wenn slskd nicht antwortet.

## Widget

**slskd-Downloads** zeigt die Download-Geschwindigkeit, die laufenden (und wartenden) Downloads,
die Restzeit, dann den Zustand von slskd, die laufenden Dateien mit Prozent und Restzeit, die
fehlgeschlagenen Downloads, die Uploads und den letzten Download. Wenn das Aufräumen erlaubt ist,
leert eine Taste **Fertige leeren** die Liste der fertigen Downloads.

## Szenen-Auslöser

- **Download abgeschlossen**: Eine Datei ist fertig heruntergeladen, einmal pro Datei. Variablen:
  Dateiname, Soulseek-Benutzer, Größe (MB).
- **Download fehlgeschlagen**: Ein Download ist fehlgeschlagen (vom Partner abgelehnt, Fehler,
  Zeitüberschreitung), einmal pro Datei. Variablen: Dateiname, Soulseek-Benutzer, Grund. Ein
  Download, den du selbst abbrichst, ist kein Fehler.
- **Alle Downloads fertig**: Nichts mehr herunterzuladen, der letzte Download ist fertig oder
  fehlgeschlagen.
- **Soulseek-Netzwerk verloren**: slskd ist nicht mehr mit dem Soulseek-Server verbunden, bei zwei
  Lesungen hintereinander (slskd verbindet sich in wenigen Sekunden selbst neu: Ein kurzer
  Aussetzer wird nicht gemeldet).
- **Soulseek-Netzwerk wieder da**: slskd ist nach einem Verlust wieder verbunden.

Nach einem Neustart der Integration wird gemeldet, was inzwischen passiert ist; die beim ersten
Start schon vorhandene Liste nicht.

## Szenen-Aktionen

- **slskd-Zusammenfassung lesen**: ein Satz für eine Nachricht („Soulseek: mit Soulseek
  verbunden, 2 Download(s) laufen, 1 warten (850 KB/s)“) und die Zahlen: verbunden (1/0), laufende,
  wartende und fehlgeschlagene Downloads.
- **Fertige Downloads leeren**: Entfernt fertige Downloads (erfolgreich, fehlgeschlagen oder
  abgebrochen) aus der Liste von slskd; die Dateien bleiben auf der Platte. Abgelehnt, solange
  **Aufräumen fertiger Downloads erlauben** aus ist. Ausgabe: die aus der Liste entfernten
  Downloads.

## Szenen-Beispiele

- **Album heruntergeladen**: Auslöser **Download abgeschlossen**, Aktion „Nachricht senden“:
  „Heruntergeladen: {{name}} von {{user}}“.
- **Abendbericht**: täglich um 21:00 **slskd-Zusammenfassung lesen**, dann den Satz per Telegram
  senden.
- **Soulseek ausgefallen**: Auslöser **Soulseek-Netzwerk verloren**, Aktion „Nachricht senden“,
  um das Konto oder das VPN von slskd zu prüfen; **Soulseek-Netzwerk wieder da**, um Entwarnung zu
  geben.
- **Aufgeräumte Liste**: Auslöser **Alle Downloads fertig**, Aktion **Fertige Downloads leeren**
  (mit erlaubtem Aufräumen).

## Fehlerbehebung

- **API-Schlüssel abgelehnt**: Prüfe den Schlüssel in `slskd.yml` und dass die Adresse von Gladys
  in seinem `cidr` liegt. slskd liest seine Konfiguration beim Speichern neu; starte es im Zweifel
  neu. Speichere dann die Konfiguration der Integration: Ein abgelehnter Schlüssel wird nicht von
  selbst wiederholt, um das Protokoll von slskd nicht zu füllen.
- **slskd antwortet nicht**: Prüfe Adresse und Port (5030) und dass der Gladys-Server slskd
  erreicht (Firewall, Docker-Netzwerk).
- **Kein slskd unter dieser Adresse**: Die Adresse antwortet, aber nicht mit der API von slskd.
  Prüfe den Port oder den Pfad hinter einem Reverse Proxy.
- **Die Rolle des API-Schlüssels erlaubt das nicht**: Das Aufräumen braucht einen
  `readwrite`-Schlüssel.
- **Soulseek getrennt**: slskd antwortet, ist aber nicht bei Soulseek angemeldet: Konto, Passwort
  oder Netzwerk von slskd (VPN). Sieh im Protokoll von slskd nach.

## Grenzen

- Ein slskd pro Integration.
- Absichtlich nur lesend: keine Suche, kein Download, kein Teilen, keine Nachricht auf Soulseek.
- Die Zähler der fertigen und fehlgeschlagenen Downloads folgen der Liste von slskd und sinken,
  wenn du sie leerst.
- Die Verzögerung der Auslöser ist das Aktualisierungsintervall. Ein Download, der zwischen zwei
  Lesungen beginnt und endet, wird trotzdem gemeldet, solange er noch in der Liste steht.
- Eine neue Adresse beginnt die Verfolgung von vorn: Was während der Änderung fertig wurde, wird nicht gemeldet.
- Nicht mit slskd oder Soulseek verbunden.
