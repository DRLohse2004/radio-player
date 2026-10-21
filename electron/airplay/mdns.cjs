// Schlanke Bonjour-Ankündigung (mDNS/DNS-SD) für den AirPlay-Empfänger.
//
// Warum nicht eine Komplettbibliothek mit Namenskonflikt-Prüfung? In größeren Netzwerken spiegeln
// Bonjour-Gateways Prüfanfragen oft sofort als Antwort zurück. Strenge Bibliotheken halten das für
// einen Namenskonflikt und benennen sich endlos um. Wir kündigen einfach an und beantworten
// Anfragen; der Name ist durch die Hardware-Adresse ohnehin eindeutig.

'use strict';

const multicastDns = require('multicast-dns');

class ServiceAnnouncer {
  /**
   * @param {{ type: string, instance: string, port: number, txt: Record<string,string>,
   *           host: string, target?: string, addresses: string[] }} options
   *   type z. B. "_raop._tcp.local", instance "02A1B2C3D4E5@Radio", host "radio-02a1b2c3d4e5.local".
   *   target: Rechnername im SRV-Eintrag (Standard: host).
   */
  constructor(options) {
    this.options = options;
    this.sockets = [];
    this.timers = [];
  }

  get fqdn() {
    return `${this.options.instance}.${this.options.type}`;
  }

  records(ttlScale = 1) {
    const { type, port, txt, host } = this.options;
    const ttl = (t) => Math.round(t * ttlScale);
    const txtData = Object.entries(txt).map(([k, v]) => Buffer.from(`${k}=${v}`));
    return {
      // Kurze Lebensdauer (2 min) statt der üblichen 75 min: Wird die App hart beendet, verschwindet
      // der Eintrag schnell wieder aus Gateways und AirPlay-Listen. Erneuert wird jede Minute.
      ptr: { name: type, type: 'PTR', ttl: ttl(120), data: this.fqdn },
      srv: { name: this.fqdn, type: 'SRV', ttl: ttl(120), flush: true, data: { port, target: this.options.target || host, priority: 0, weight: 0 } },
      txt: { name: this.fqdn, type: 'TXT', ttl: ttl(120), flush: true, data: txtData },
      services: { name: '_services._dns-sd._udp.local', type: 'PTR', ttl: ttl(120), data: type },
    };
  }

  aRecords(address, ttlScale = 1) {
    return [{ name: this.options.host, type: 'A', ttl: Math.round(120 * ttlScale), flush: true, data: address }];
  }

  start() {
    for (const address of this.options.addresses) {
      const mdns = multicastDns({ interface: address, reuseAddr: true, loopback: false });
      mdns.on('error', () => {});
      mdns.on('query', (query, rinfo) => this.answer(mdns, address, query, rinfo));
      this.sockets.push({ mdns, address });
      // Ankündigung nach RFC 6762: mehrmals mit wachsendem Abstand
      for (const delay of [0, 1000, 3000]) {
        this.timers.push(setTimeout(() => this.announce(mdns, address), delay));
      }
    }
    // regelmäßig erneuern, damit Caches (auch Gateways) den Eintrag behalten
    this.timers.push(setInterval(() => this.sockets.forEach(({ mdns, address }) => this.announce(mdns, address)), 60_000));
  }

  announce(mdns, address) {
    const r = this.records();
    mdns.respond({ answers: [r.ptr, r.srv, r.txt, ...this.aRecords(address)] });
  }

  answer(mdns, address, query, rinfo) {
    const r = this.records();
    const lower = (s) => s.toLowerCase();
    const answers = [];
    for (const q of query.questions) {
      const name = lower(q.name);
      const any = q.type === 'ANY';
      if (name === lower(this.options.type) && (q.type === 'PTR' || any)) answers.push(r.ptr);
      if (name === '_services._dns-sd._udp.local' && (q.type === 'PTR' || any)) answers.push(r.services);
      if (name === lower(this.fqdn)) {
        if (q.type === 'SRV' || any) answers.push(r.srv);
        if (q.type === 'TXT' || any) answers.push(r.txt);
      }
      if (name === lower(this.options.host) && (q.type === 'A' || any)) answers.push(...this.aRecords(address));
    }
    if (!answers.length) return;
    // zu PTR/SRV gehören SRV/TXT/A als Zusatzinfos, damit das iPhone sofort verbinden kann
    const additionals = [];
    if (answers.includes(r.ptr)) additionals.push(r.srv, r.txt);
    if (answers.includes(r.ptr) || answers.includes(r.srv)) additionals.push(...this.aRecords(address));
    const response = { answers, additionals: additionals.filter((a) => !answers.includes(a)) };
    if (rinfo && rinfo.port !== 5353) {
      // "Legacy-Unicast" (RFC 6762, Abschnitt 6.7): Anfrage kam nicht von Port 5353 –
      // direkt an den Absender antworten, mit derselben ID und den Fragen
      mdns.respond({ ...response, id: query.id, questions: query.questions }, { port: rinfo.port, address: rinfo.address });
    } else {
      mdns.respond(response);
    }
  }

  /**
   * Meldet den Dienst ab ("Goodbye", TTL 0) – zweimal, falls ein Paket verloren geht – und schließt
   * die Sockets. Das Promise erfüllt sich, wenn die Abmeldung raus ist (höchstens nach ~1,5 s).
   */
  stop() {
    for (const t of this.timers) clearTimeout(t), clearInterval(t);
    this.timers = [];
    const sockets = this.sockets;
    this.sockets = [];
    const goodbye = ({ mdns, address }) =>
      new Promise((resolve) => {
        const r = this.records(0);
        const packet = { answers: [r.ptr, r.srv, r.txt, ...this.aRecords(address, 0)] };
        const finish = () => {
          try {
            mdns.destroy();
          } catch {
            // schon zu
          }
          resolve();
        };
        const safety = setTimeout(finish, 1500);
        try {
          mdns.respond(packet, () => {
            setTimeout(() => {
              try {
                mdns.respond(packet, () => {
                  clearTimeout(safety);
                  finish();
                });
              } catch {
                clearTimeout(safety);
                finish();
              }
            }, 250);
          });
        } catch {
          clearTimeout(safety);
          finish();
        }
      });
    return Promise.all(sockets.map(goodbye)).then(() => undefined);
  }
}

module.exports = { ServiceAnnouncer };
