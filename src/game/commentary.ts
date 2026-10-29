/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ROLES } from './constants.ts';

export type CommentaryEventType =
  | 'kickoff'
  | 'goal'
  | 'score_lead'
  | 'score_equalizer'
  | 'score_gap'
  | 'post_hit'
  | 'save'
  | 'missed_shot'
  | 'interception'
  | 'out_of_bounds'
  | 'pass'
  | 'shot'
  | 'timeout'
  | 'half_time'
  | 'last_minute'
  | 'extra_time'
  | 'match_end'
  | 'turnover';

export const COMMENTARY_PRIORITY: Record<CommentaryEventType, number> = {
  goal: 100,
  match_end: 95,
  extra_time: 92,
  kickoff: 90,
  score_equalizer: 88,
  score_lead: 87,
  score_gap: 86,
  last_minute: 85,
  half_time: 84,
  post_hit: 80,
  save: 70,
  missed_shot: 60,
  interception: 55,
  timeout: 50,
  out_of_bounds: 45,
  pass: 40,
  shot: 30,
  turnover: 20,
};

export interface CommentaryContext {
  teamName?: string;
  opponentName?: string;
  playerIndex?: number; // 0..6
  receiverIndex?: number; // 0..6
  minute?: string;
  scoreA?: number;
  scoreB?: number;
}

export interface CommentaryEntry {
  id: number;
  type: CommentaryEventType;
  text: string;
  time: string;
  priority: number;
}

const TEMPLATES: Record<CommentaryEventType, string[]> = {
  kickoff: [
    "{minute} Hakem ilk düdüğü çaldı! {team} ve {opponent} arasındaki dev mücadele başladı!",
    "{minute} Santra vuruşuyla heyecan başladı, {team} maça hızlı girmek istiyor!",
    "{minute} Tribünler ayakta! {team} - {opponent} karşılaşmasında ilk düdük geldi!",
    "{minute} Dünya Kupası sahnesinde büyük randevu başladı, iki takıma da başarılar!",
    "{minute} Top santrada, {team} kontrollü bir başlangıç peşinde!",
    "{minute} Dev maçta ilk vuruş yapıldı, sahada taktik savaşı başlıyor!",
    "{minute} Düdük çaldı ve perde açıldı! {team} ile {opponent} kozlarını paylaşıyor!",
    "{minute} Heyecan dorukta, {team} maça oldukça istekli başladı!",
  ],
  goal: [
    "GOOOOL! {minute} {team} adına {player} muhteşem bir vuruşla ağları sarstı! Skor: {score}",
    "TOP AĞLARDA! {minute} {team} formasıyla {player} kaleciyi çaresiz bıraktı! ({score})",
    "İNANILMAZ GOL! {minute} {team} hücumunda {player} tam köşeyi gördü! Skor şimdi {score}!",
    "HARİKA BİR BİTİRİŞ! {minute} {player} sahneye çıktı, {team} tribünleri bayram yeri! ({score})",
    "GOOOOL! {minute} {team} aradığı golü {player} ile buldu! Skor tabelası {score} oldu!",
    "FİLELER HAVALANDI! {minute} {player} soğukkanlı vurdu, {team} golü yazdı! ({score})",
    "MÜTHİŞ VURUŞ VE GOL! {minute} {team} cephesinde {player} affetmedi! ({score})",
    "GOL! GOL! GOL! {minute} {team} atağında {player} meşin yuvarlağı ağlarla buluşturdu! ({score})",
  ],
  score_lead: [
    "{minute} {team} bu golle {score} öne geçiyor! Maçta dengeler değişti!",
    "{minute} {team} üstünlüğü ele aldı! Skor {score}, {opponent} karşılık vermek zorunda!",
    "{minute} Kritik an! {team} {player} ile skoru {score} yaparak liderliği kaptı!",
    "{minute} {team} öne geçti ({score})! Taktik disiplin meyvesini verdi!",
    "{minute} Tabelada artık {team} üstünlüğü var: {score}! Baskı sonuç getirdi!",
    "{minute} {team} taraftarı coşkulu, takım {score} ile maçta öne fırladı!",
    "{minute} Altın değerinde bir golle {team} {score} öne geçmeyi başardı!",
    "{minute} {team} skoru {score} yaptı ve maçın kontrolünü eline aldı!",
  ],
  score_equalizer: [
    "{minute} Maça yeniden denge geldi! {team} skoru {score} yaparak eşitliği sağladı!",
    "{minute} Pes etmediler! {team} {player} ile skoru {score} seviyesine getirdi!",
    "{minute} Beraberlik golü! {team} maça ortak oluyor, tabelada {score} yazıyor!",
    "{minute} Heyecan sıfırdan başlıyor! {team} eşitliği yakaladı: {score}!",
    "{minute} {team} anında reaksiyon gösterdi ve skoru {score} ile dengeledi!",
    "{minute} Nefes kesen maçta {team} beraberliği kurtardı: {score}!",
    "{minute} Mücadelede tekrar eşitlik var ({score})! {team} oyundan kopmadı!",
    "{minute} {team} kritik dakikada bulduğu golle skoru {score} yaptı!",
  ],
  score_gap: [
    "{minute} {team} farkı açıyor! Skor {score} oldu, {opponent} savunması zor anlar yaşıyor!",
    "{minute} {team} fırtınası sürüyor! {player} ile fark büyüdü: {score}!",
    "{minute} Rahatlatan gol! {team} skoru {score} yaparak büyük avantaj yakaladı!",
    "{minute} {team} durmak bilmiyor, skor {score} seviyesine taşındı!",
    "{minute} Sahada {team} rüzgarı esiyor! Fark açıldı, tabelada {score} var!",
    "{minute} {team} üstünlüğünü perçinledi ({score}), {opponent} için işler çok zor!",
    "{minute} {team} hücum hattı şov yapıyor! Skor {score} ile farka gidiyor!",
    "{minute} {team} bir gol daha bularak skoru {score} yaptı, kupa yolunda dev adım!",
  ],
  post_hit: [
    "DİREKTEN DÖNDÜ! {minute} {team} adına {player} çok sert vurdu ama direk gole izin vermedi!",
    "İNANILMAZ AN! {minute} {team} gole çok yaklaştı, top direkten oyun alanına döndü!",
    "ÇERÇEVE SALLANDI! {minute} {player} harika vurdu fakat meşin yuvarlak direkten patladı!",
    "ŞANSSIZLIK! {minute} {team} atağında top yan direğe çarpıp tehlike bölgesinden uzaklaştı!",
    "DİREK SESİ STADYUMDA YANKILANDI! {minute} {team} milimetrelerle golü kaçırdı!",
    "AH DİREK! {minute} {player} kaleciyi geçti ama direği geçemedi!",
    "GOLE ÇOK YAKLAŞTILAR! {minute} {team} şutunda direk {opponent} kalesini kurtardı!",
    "DİREKTEN OYUNA! {minute} {team} cephesinde {player} saç baş yoldurdu!",
  ],
  save: [
    "MÜTHİŞ KURTARIŞ! {minute} {opponent} kalecisi #1 Kaleci kalesinde devleşti!",
    "KALECİ GEÇİT VERMEDİ! {minute} {team} şutunda #1 Kaleci harika bir refleksle golü önledi!",
    "ALTIN DEĞERİNDE KURTARIŞ! {minute} #1 Kaleci köşeden topu çıkarmayı başardı!",
    "KALEDE DUVAR VAR! {minute} {player} vurdu ama {opponent} kalecisi #1 Kaleci topu çeldi!",
    "İNANILMAZ REFLEKS! {minute} #1 Kaleci yakın mesafeden gelen şutu ustalıkla savuşturdu!",
    "BÜYÜK KURTARIŞ! {minute} {team} gole giderken {opponent} kalecisi sahneye çıktı!",
    "ELDİVENLER KONUŞTU! {minute} {player} sert yokladı, #1 Kaleci gole kapıyı kapattı!",
    "KRİTİK MÜDAHALE! {minute} {opponent} kalecisi #1 Kaleci takımını ayakta tutuyor!",
  ],
  missed_shot: [
    "{minute} {team} adına {player} kaleyi denedi ancak top yandan auta çıktı!",
    "{minute} Tehlikeli şut! {team} atağında {player} çerçeveyi bulamadı, aut!",
    "{minute} {team} uzaktan şansını denedi fakat top kale direğinin yanından dışarı gitti!",
    "{minute} Kaçan fırsat! {player} sert vurdu ama isabet sağlayamadı!",
    "{minute} {team} hücumu autla sonuçlandı, {opponent} kale vuruşuyla başlayacak!",
    "{minute} {player} uygun pozisyonda vurdu ancak top az farkla dışarı çıktı!",
    "{minute} {team} kaleyi yokladı ama meşin yuvarlak hedefi bulmadı!",
    "{minute} Sert şut auta gitti! {team} bu pozisyondan eli boş dönüyor!",
  ],
  interception: [
    "{minute} Kritik müdahale! {team} savunmada {player} ile topu söktü aldı!",
    "{minute} Harika top kapma! {team} adına {player} rakip atağı başlamadan kesti!",
    "{minute} Savunma duvarı! {team} oyuncusu {player} araya girerek tehlikeyi önledi!",
    "{minute} {team} presle topu kazandı! {player} zamanında müdahale etti!",
    "{minute} Geçit yok! {team} savunmasında {player} rakibin pas kanalını kapattı!",
    "{minute} Usta işi müdahale! {player} araya girdi ve top {team} kontrolüne geçti!",
    "{minute} {team} orta alanda {player} ile baskı yaptı ve topu kapmayı başardı!",
    "{minute} {opponent} atağını {team} adına {player} yerinde bir hamleyle durdurdu!",
  ],
  out_of_bounds: [
    "{minute} Top yan çizgiden sekti, {opponent} vuruş hakkını devralıyor!",
    "{minute} Meşin yuvarlak saha kenarına çarptı, sıra şimdi {opponent} takımında!",
    "{minute} {team} kontrolü sağlayamadı, çizgi temasının ardından sıra {opponent} ekibinde!",
    "{minute} Kenar çizgisi dönüşü! Top {opponent} kontrolüne geçti!",
    "{minute} Hızlı top kenar bandından döndü, {opponent} yeni atağa hazırlanıyor!",
    "{minute} Saha kenarında top kaybı! Sıra {opponent} tarafına geçti!",
    "{minute} {team} vuruşunda top çizgiye çarptı, hamle sırası {opponent} takımında!",
    "{minute} Top kenar çizgisinden oyun alanına döndü, sıra {opponent} ekibinde!",
  ],
  pass: [
    "{minute} Şık pas! {team} adına {player}, topu {receiver} ile buluşturdu!",
    "{minute} Organize atak! {team} cephesinde {player} pasını {receiver} ayağına gönderdi!",
    "{minute} İsabetli pas bağlantısı! {team} takımında {receiver} topu kontrol etti!",
    "{minute} Akıl dolu pas! {player} gördü, {receiver} şimdi tehlikeli bölgede!",
    "{minute} {team} kısa paslarla ilerliyor, {player} -> {receiver} bağlantısı başarılı!",
    "{minute} Harika paslaşma! {team} adına {receiver} ekstra vuruş fırsatını yakaladı!",
    "{minute} {team} orta sahada pas üçgeni kurdu, top şimdi {receiver} kontrolünde!",
    "{minute} Temiz pas! {player} topu {receiver} önüne bıraktı, {team} atağı sürüyor!",
  ],
  shot: [
    "{minute} {team} adına {player} kaleyi cepheden yokladı!",
    "{minute} {team} hücumunda {player} sert bir fiske çıkardı!",
    "{minute} {player} sorumluluk aldı, {team} atağı hız kazandı!",
    "{minute} {team} cephesinde {player} rakip kaleye doğru yüklendi!",
    "{minute} {player} ayağından çıkan sert top ceza sahasına yöneldi!",
    "{minute} {team} atağında {player} boşluğu görünce vuruşunu yaptı!",
    "{minute} {player} topa falsolu bir vuruş gönderdi, gözler kalede!",
    "{minute} {team} {player} ile rakip savunmanın kilidini açmaya çalışıyor!",
  ],
  timeout: [
    "{minute} 10 saniye süresi doldu! {team} zamanında vuramayınca sıra {opponent} takımına geçti!",
    "{minute} Hakem süreyi işaret etti! {team} 10 saniyeyi aştı, top {opponent} ekibinde!",
    "{minute} Kararsızlık pahalıya patladı! {team} süreyi tüketince hamle sırası {opponent} tarafında!",
    "{minute} 10 saniye kuralı işledi! {team} gecikince hak {opponent} takımına verildi!",
    "{minute} Süre ihlali! {team} vuruş yapamadı, {opponent} topun başına geçiyor!",
    "{minute} Kronometre sıfırlandı! {team} hakkını kaybetti, sıra {opponent} ekibinde!",
    "{minute} Hakem düdüğüyle sıra değişti: {team} 10 saniye içinde oynayamadı!",
    "{minute} Taktik düşünce uzayınca süre bitti, sıra {opponent} takımına geçti!",
  ],
  half_time: [
    "{minute} Maçta ilk yarı geride kaldı! Skor: {score}. İkinci yarıda heyecan artacak!",
    "{minute} 45 dakika tamamlandı! {team} ve {opponent} mücadelesinde tempo yüksek ({score})!",
    "{minute} Maçın orta noktasına geldik ({score})! İki takım da tüm gücünü ortaya koyuyor!",
    "{minute} Devre ortası geçiliyor! Tabelada {score} var, her an her şey olabilir!",
    "{minute} İlk 45 dakikalık bölüm bitti ({score}), şimdi taktik hamlelerin zamanı!",
    "{minute} Mücadelenin yarısı geride kaldı! {team} - {opponent} maçında skor {score}!",
    "{minute} 45' geçildi! Sahada nefes kesen bir çekişme var ({score})!",
    "{minute} İkinci devre temposu başlıyor! Mevcut skor: {score}!",
  ],
  last_minute: [
    "{minute} Maçta son dakikalara girildi! Skor {score}, heyecan dorukta!",
    "{minute} Artık telafisi olmayan anlar! Tabelada {score} yazıyor, son düdük yakın!",
    "{minute} Son bölümde nefesler tutuldu! {team} ve {opponent} son kozlarını oynuyor ({score})!",
    "{minute} Kronometre hızla eriyor! {score} skoruyla kritik son dakikalar!",
    "{minute} Tribünler ayakta, maçta son viraja girildi! Skor: {score}!",
    "{minute} Her vuruş altın değerinde! Maçın bitimine çok az kaldı ({score})!",
    "{minute} Son dakika uyarısı! {team} - {opponent} maçında kalpler hızla çarpıyor ({score})!",
    "{minute} Bitiş düdüğüne saniyeler kala sahada büyük heyecan ({score})!",
  ],
  extra_time: [
    "Uzatma Devresi başladı! Altın Gol kuralı geçerli: İlk golü atan maçı kazanır!",
    "Normal süre {score} eşitlikle bitti! Şimdi Altın Gol uzatma heyecanı başlıyor!",
    "Eleme maçında nefes kesen uzatma! İlk golü bulan takım üst tura yükselecek!",
    "Uzatma dakikaları start aldı! Tek bir hata bile maçı bitirebilir ({score})!",
    "Altın Gol devresi! {team} ve {opponent} tur bileti için son kez sahada!",
    "90 dakika yetmedi ({score})! Uzatmada golü atan her şeyi alır!",
    "Uzatma düdüğü çaldı! Sahada maksimum konsantrasyon, hedef Altın Gol!",
    "Heyecan uzatmalara taşındı ({score})! İlk fileleri havalandıran zaferi kutlayacak!",
  ],
  match_end: [
    "SON DÜDÜK! {minute} Karşılaşma {score} skoruyla sona erdi!",
    "MAÇ BİTTİ! {minute} Hakem son düdüğü çaldı, mücadelede tabelada {score} var!",
    "VE PERDE KAPANDI! {minute} {team} - {opponent} mücadelesi {score} tamamlandı!",
    "90 DAKİKA SONA ERDİ! {minute} Büyük heyecanda maç sonucu: {score}!",
    "BİTİŞ DÜDÜĞÜ GELDİ! {minute} Sahadaki müthiş mücadele {score} bitti!",
    "KARŞILAŞMA TAMAMLANDI! {minute} Hakem maçı bitiren düdüğü çaldı ({score})!",
    "MAÇ SONUCU: {score}! {minute} İki takım da sahada tüm enerjisini harcadı!",
    "SON DÜDÜK ÇALDI! {minute} Dünya Kupası heyecanında maç {score} sonuçlandı!",
  ],
  turnover: [
    "{minute} {team} atağı sonuçsuz kaldı, vuruş sırası {opponent} takımında!",
    "{minute} Top durdu ve sıra değişti! Şimdi {opponent} hücum hazırlığında!",
    "{minute} Hamle sırası {opponent} ekibine geçti, sahada yeni bir kurgu başlıyor!",
    "{minute} {team} vuruşunu tamamladı, {opponent} kendi yarı sahasından çıkıyor!",
    "{minute} Sıra {opponent} takımında! Bakalım nasıl bir taktik tercih edecekler!",
    "{minute} Topun kontrolü {opponent} tarafına geçti, gözler yeni hamlede!",
    "{minute} {team} pozisyonu değerlendiremedi, sıra {opponent} ekibinde!",
    "{minute} Vuruş tamamlandı, şimdi {opponent} sahada söz sahibi!",
  ],
};

export function formatPlayerRoleLabel(playerIndex?: number): string {
  if (playerIndex === undefined || playerIndex < 0 || playerIndex >= ROLES.length) {
    return '#7 Forvet';
  }
  const role = ROLES[playerIndex];
  return `#${role.number} ${role.name}`;
}

export class CommentaryController {
  private nextId = 1;
  private lastTemplateIdx: Partial<Record<CommentaryEventType, number>> = {};
  private lastText = '';
  private history: CommentaryEntry[] = [];
  private pendingEvent: { type: CommentaryEventType; ctx: CommentaryContext; priority: number } | null = null;

  constructor(initialTeamA = 'Ev Sahibi', initialTeamB = 'Konuk') {
    this.emitImmediate('kickoff', {
      teamName: initialTeamA,
      opponentName: initialTeamB,
      minute: "1'",
      scoreA: 0,
      scoreB: 0,
    });
  }

  public getHistory(): CommentaryEntry[] {
    return this.history;
  }

  public getLatest(): CommentaryEntry {
    return (
      this.history[0] || {
        id: 1,
        type: 'kickoff',
        text: "1' Maç başladı! İki takıma da başarılar dileriz.",
        time: "1'",
        priority: 90,
      }
    );
  }

  private renderTemplate(type: CommentaryEventType, ctx: CommentaryContext): string {
    const pool = TEMPLATES[type] || TEMPLATES.turnover;
    const prevIdx = this.lastTemplateIdx[type] ?? -1;

    // Pick a template index guaranteed to differ from prevIdx and from lastText
    let chosenIdx = (prevIdx + 1) % pool.length;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidateIdx = (prevIdx + 1 + offset) % pool.length;
      const candidateText = this.interpolate(pool[candidateIdx], ctx);
      if (candidateIdx !== prevIdx && candidateText !== this.lastText) {
        chosenIdx = candidateIdx;
        break;
      }
    }

    this.lastTemplateIdx[type] = chosenIdx;
    const rendered = this.interpolate(pool[chosenIdx], ctx);
    this.lastText = rendered;
    return rendered;
  }

  private interpolate(template: string, ctx: CommentaryContext): string {
    const minute = ctx.minute || "1'";
    const team = ctx.teamName || 'Takım';
    const opponent = ctx.opponentName || 'Rakip';
    const player = formatPlayerRoleLabel(ctx.playerIndex);
    const receiver = formatPlayerRoleLabel(ctx.receiverIndex);
    const score =
      ctx.scoreA !== undefined && ctx.scoreB !== undefined ? `${ctx.scoreA}-${ctx.scoreB}` : '0-0';

    return template
      .replace(/\{minute\}/g, minute)
      .replace(/\{team\}/g, team)
      .replace(/\{opponent\}/g, opponent)
      .replace(/\{player\}/g, player)
      .replace(/\{receiver\}/g, receiver)
      .replace(/\{score\}/g, score);
  }

  /**
   * Queues an event during an active shot/turn. Only the highest priority event
   * (e.g. goal > post_hit > save > missed_shot > interception > pass > turnover)
   * wins when flushed, preventing overlapping or contradictory lines.
   */
  public queueTurnEvent(type: CommentaryEventType, ctx: CommentaryContext): void {
    const priority = COMMENTARY_PRIORITY[type] ?? 10;
    if (!this.pendingEvent || priority > this.pendingEvent.priority) {
      this.pendingEvent = { type, ctx, priority };
    }
  }

  public clearPending(): void {
    this.pendingEvent = null;
  }

  public flushPendingTurnEvent(fallbackType?: CommentaryEventType, fallbackCtx?: CommentaryContext): CommentaryEntry | null {
    if (this.pendingEvent) {
      const { type, ctx } = this.pendingEvent;
      this.pendingEvent = null;
      return this.emitImmediate(type, ctx);
    }
    if (fallbackType && fallbackCtx) {
      return this.emitImmediate(fallbackType, fallbackCtx);
    }
    return null;
  }

  public emitImmediate(type: CommentaryEventType, ctx: CommentaryContext): CommentaryEntry {
    const text = this.renderTemplate(type, ctx);
    const entry: CommentaryEntry = {
      id: ++this.nextId,
      type,
      text,
      time: ctx.minute || "1'",
      priority: COMMENTARY_PRIORITY[type] ?? 10,
    };
    this.history = [entry, ...this.history].slice(0, 3);
    return entry;
  }
}
