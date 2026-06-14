import { BrowserContext } from '@playwright/test';
import { Property } from './types';

export interface VerifyResult {
  available: boolean;
  infoUpdated: string;
  nextUpdate: string;
  note: string;
}

const TODAY = new Date('2026-06-14');

function parseJpDate(s: string): Date | null {
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 単一の詳細ページを検証する
async function verifyOne(context: BrowserContext, url: string): Promise<VerifyResult> {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // HTTPエラー or 物件が削除済み
    if (resp && resp.status() >= 400) {
      return { available: false, infoUpdated: '', nextUpdate: '', note: `HTTP ${resp.status()}` };
    }

    const title = await page.title();

    const data = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      // 掲載終了・募集終了の判定
      const ended =
        /掲載(が)?終了|募集(を|は)?終了|この物件は(現在)?ご紹介できません|ご指定の物件は見つかりません|該当する物件はありません/.test(
          bodyText
        );

      // 情報更新日 / 次回更新予定日 を th/td から抽出
      let infoUpdated = '';
      let nextUpdate = '';
      document.querySelectorAll('th').forEach((th) => {
        const label = (th as HTMLElement).innerText?.replace(/\s+/g, '').trim() ?? '';
        const td = th.nextElementSibling as HTMLElement | null;
        const val = td ? td.innerText?.replace(/\s+/g, ' ').trim() : '';
        if (!val) return;
        if (label.includes('情報更新日')) infoUpdated = val;
        if (label.includes('次回更新予定日')) nextUpdate = val;
      });

      // 物件名（ページが正常に物件詳細であることの確認）
      const h1 = document.querySelector('h1')?.textContent?.trim() ?? '';

      return { ended, infoUpdated, nextUpdate, h1 };
    });

    // エラーページ判定
    if (title.includes('エラー') || !data.h1) {
      return { available: false, infoUpdated: data.infoUpdated, nextUpdate: data.nextUpdate, note: 'ページ異常/物件なし' };
    }

    if (data.ended) {
      return { available: false, infoUpdated: data.infoUpdated, nextUpdate: data.nextUpdate, note: '掲載/募集終了' };
    }

    // 次回更新予定日が過去 → 放置されたおとり物件の疑い
    const next = parseJpDate(data.nextUpdate);
    if (next && next < TODAY) {
      return {
        available: false,
        infoUpdated: data.infoUpdated,
        nextUpdate: data.nextUpdate,
        note: `更新期限切れ(${data.nextUpdate})`,
      };
    }

    // 情報更新日が無い or 30日以上前 → 鮮度低
    const info = parseJpDate(data.infoUpdated);
    if (info) {
      const days = Math.round((TODAY.getTime() - info.getTime()) / 86400000);
      if (days > 30) {
        return {
          available: false,
          infoUpdated: data.infoUpdated,
          nextUpdate: data.nextUpdate,
          note: `更新が${days}日前と古い`,
        };
      }
    }

    return { available: true, infoUpdated: data.infoUpdated, nextUpdate: data.nextUpdate, note: '募集中' };
  } catch (e) {
    return { available: false, infoUpdated: '', nextUpdate: '', note: `取得失敗: ${(e as Error).message.slice(0, 40)}` };
  } finally {
    await page.close();
  }
}

// 並列度を制限しながら全物件を検証して available 等を付与する
export async function verifyProperties(
  context: BrowserContext,
  properties: Property[],
  concurrency = 4
): Promise<Property[]> {
  let idx = 0;
  let done = 0;
  const total = properties.length;

  async function worker() {
    while (idx < properties.length) {
      const i = idx++;
      const p = properties[i];
      const r = await verifyOne(context, p.url);
      p.available = r.available;
      p.infoUpdated = r.infoUpdated;
      p.nextUpdate = r.nextUpdate;
      p.verifyNote = r.note;
      done++;
      if (done % 5 === 0 || done === total) {
        console.log(`  検証 ${done}/${total} 件完了`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return properties;
}
