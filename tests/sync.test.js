// Проверка синхронизации двумя «устройствами» на имитации GitHub:
//   python3 tools/ghmock.py 8771   (каждый прогон — с чисто запущенной имитацией)
//   node tests/sync.test.js <url приложения> <папка для временных файлов> [порт имитации, по умолчанию 8771]
const {chromium} = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const URL = process.argv[2], TMP = process.argv[3], MOCK = 'http://127.0.0.1:' + (process.argv[4] || 8771);
let ok = 0, fail = 0;
const eq = (n, g, e) => { if (JSON.stringify(g) === JSON.stringify(e)) ok++; else { fail++; console.log('✗', n, '\n   получено:', JSON.stringify(g), '\n   ожидалось:', JSON.stringify(e)); } };
const sorted = a => a.slice().sort();

(async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
  const errors = [];
  const device = async (name, connect) => {
    const ctx = await browser.newContext({viewport: {width: 1280, height: 720}});
    await ctx.addInitScript(([api, c]) => { localStorage.setItem('mrtekhnik.sync.api', api); if (c) localStorage.setItem('mrtekhnik.sync', JSON.stringify({repo: 'mrtekhnik/sync', token: 'test-token'})); }, [MOCK, connect]);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    await p.goto(URL);
    return p;
  };
  const type = async (p, s) => { for (const ch of s) await p.keyboard.press(ch === '\n' ? 'Enter' : ch); };
  const exprs = p => p.evaluate(() => vis().map(l => C.exprText(l.expr, () => 0) + (l.label ? ' [' + l.label + ']' : '')));
  const trashN = p => p.evaluate(() => trash().length);
  const sync = async p => {
    await p.evaluate(() => { const t = document.querySelector('#toast'); t.textContent = ''; });
    await p.click('#syncBtn');
    await p.waitForFunction(() => !document.querySelector('#busy') && !syncing);
    const dlg = await p.isVisible('#dlg') ? (await p.textContent('#dlg .box')).replace(/\s+/g, ' ').trim() : '';
    if (dlg) await p.click('#dlg .btns .pri');
    return dlg || (await p.textContent('#toast'));
  };

  // подключение через настройки: проверка токена и приватности
  const A = await device('A', false);
  eq('без подключения кнопки ⟳ нет', await A.$eval('#syncBtn', n => n.classList.contains('hidden')), true);
  await A.click('#menuBtn'); await A.click('#dlg .mi[data-r="st"]');
  await A.fill('#syRepo', 'mrtekhnik/sync'); await A.fill('#syTok', 'wrong');
  await A.click('#sySave'); await A.waitForFunction(() => document.querySelector('#syStat').textContent !== 'Проверка…');
  eq('неверный токен', (await A.textContent('#syStat')).startsWith('GitHub не принял токен'), true);
  await A.fill('#syTok', 'test-token'); await A.click('#sySave');
  await A.waitForFunction(() => document.querySelector('#syStat').textContent.includes('✓'));
  eq('подключено', await A.textContent('#syStat'), 'Подключено: mrtekhnik/sync (приватный) ✓');
  await A.click('#dlg .btns .pri');
  eq('кнопка ⟳ появилась', await A.$eval('#syncBtn', n => n.classList.contains('hidden')), false);

  // 1. первая отправка и получение на втором устройстве
  await type(A, '1+1\n2*3\n10-4\n');
  eq('есть несинхронизированное (точка)', await A.$eval('#syncBtn', n => n.classList.contains('dot')), true);
  eq('1: отправка', await sync(A), 'Синхронизировано: отправлено 3');
  eq('1: точка погасла', await A.$eval('#syncBtn', n => n.classList.contains('dot')), false);
  const B = await device('B', true);
  eq('1: получение', await sync(B), 'Синхронизировано: получено 3');
  eq('1: строки на B', await exprs(B), ['1 + 1', '2 × 3', '10 − 4']);

  // 2. правки в обе стороны
  await B.locator('#lines .ln').nth(0).locator('.d').last().click(); await B.keyboard.press('Backspace'); await B.keyboard.press('5'); await B.keyboard.press('Escape');
  await type(B, '7*7\n');
  eq('2: B отправил', await sync(B), 'Синхронизировано: отправлено 2');
  eq('2: A получил', await sync(A), 'Синхронизировано: получено 2');
  eq('2: строки на A', await exprs(A), ['1 + 5', '2 × 3', '10 − 4', '7 × 7']);

  // 3. конфликт: одну строку правят на обоих
  await A.locator('#lines .ln').nth(1).locator('.d').last().click(); await A.keyboard.press('Backspace'); await A.keyboard.press('4'); await A.keyboard.press('Escape');
  await B.locator('#lines .ln').nth(1).locator('.d').last().click(); await B.keyboard.press('Backspace'); await B.keyboard.press('8'); await B.keyboard.press('Escape');
  await sync(A);
  const conf = await sync(B);
  eq('3: сообщение о конфликте', conf.includes('Конфликтов: 1'), true);
  await sync(A);
  const ea = sorted(await exprs(A)), eb = sorted(await exprs(B));
  eq('3: обе версии на обоих устройствах', ea, eb);
  eq('3: версии 2×4 и 2×8 сохранены', ea.filter(x => x.startsWith('2 × 4') || x.startsWith('2 × 8')).length, 2);
  eq('3: копия помечена', ea.some(x => x.includes('(другая версия)')), true);

  // 4. удаление в корзину и окончательное удаление
  const n0 = (await exprs(A)).length;
  await A.locator('#lines .ln').nth(2).click({button: 'right'}); await A.click('#dlg .mi[data-r="del"]');
  eq('4: в корзине на A', await trashN(A), 1);
  await sync(A); await sync(B);
  eq('4: на B строка ушла в корзину', [(await exprs(B)).length, await trashN(B)], [n0 - 1, 1]);
  // восстановление из корзины на B → вернулась на A
  await B.click('#menuBtn'); await B.click('#dlg .mi[data-r="tr"]');
  await B.click('#dlg .tp .pk');
  eq('4: восстановлено на B', (await exprs(B)).length, n0);
  await sync(B); await sync(A);
  eq('4: восстановлено и на A', [(await exprs(A)).length, await trashN(A)], [n0, 0]);
  // снова удалить и очистить корзину на A — на B строка исчезает совсем
  await A.locator('#lines .ln').nth(2).click({button: 'right'}); await A.click('#dlg .mi[data-r="del"]');
  await A.click('#menuBtn'); await A.click('#dlg .mi[data-r="tr"]'); await A.click('#dlg [data-r="ca"]'); await A.click('#dlg .btns .dng');
  await A.keyboard.press('Escape');
  eq('4: корзина A пуста', await trashN(A), 0);
  const r4 = await sync(A);
  eq('4: A отправил окончательное удаление', r4.includes('удалено 1'), true);
  await sync(B);
  eq('4: на B удалена навсегда', [(await exprs(B)).length, await trashN(B)], [n0 - 1, 0]);

  // 5. шаблоны и их удаление
  await A.locator('#lines .ln').nth(0).click({button: 'right'}); await A.click('#moreBtn'); await A.click('#dlg .mi[data-r="tpl"]');
  await A.fill('#tName', 'Сумма'); await A.click('#dlg .btns .pri');
  eq('5: шаблон отправлен', (await sync(A)).includes('обновлены шаблоны'), false); // у отправителя набор не меняется
  eq('5: шаблон получен', (await sync(B)).includes('обновлены шаблоны'), true);
  eq('5: шаблон на B', await B.evaluate(() => S.tpl.map(t => t.name)), ['Сумма']);
  await B.click('#menuBtn'); await B.click('#moreBtn').catch(() => {}); await B.click('#dlg .mi[data-r="tpls"]');
  await B.click('#dlg .tp .x'); await B.click('#dlg .btns .dng'); await B.keyboard.press('Escape');
  await sync(B); await sync(A);
  eq('5: удаление шаблона дошло до A', await A.evaluate(() => S.tpl.length), 0);

  // 6. повторная синхронизация без изменений
  eq('6: без изменений', await sync(A), 'Всё уже синхронизировано');
  eq('6: без изменений B', await sync(B), 'Всё уже синхронизировано');

  // 7. одновременная синхронизация двух устройств
  await type(A, '100+1\n'); await type(B, '200+2\n');
  await Promise.all([sync(A), sync(B)]);
  await sync(A); await sync(B);
  const fa = sorted(await exprs(A)), fb = sorted(await exprs(B));
  eq('7: данные объединились', fa, fb);
  eq('7: обе новые строки есть', ['100 + 1', '200 + 2'].every(x => fa.includes(x)), true);
  const st = await A.evaluate(async api => (await (await fetch(api + '/repos/mrtekhnik/sync/_stats', {headers: {Authorization: 'Bearer test-token'}})).json()), MOCK);
  eq('7: одна синхронизация — один запрос записи дерева, без отдельных файлов', st.blobs, 0);

  // порядок: строки с двух устройств между синхронизациями идут по времени, а не через одну
  await type(A, '11+1\n'); await A.waitForTimeout(30); await type(A, '12+1\n'); await A.waitForTimeout(30);
  await type(B, '21+2\n'); await B.waitForTimeout(30); await type(B, '22+2\n');
  await sync(A); await sync(B); await sync(A);
  const tailA = (await exprs(A)).slice(-4), tailB = (await exprs(B)).slice(-4);
  eq('порядок по времени на A', tailA, ['11 + 1', '12 + 1', '21 + 2', '22 + 2']);
  eq('порядок одинаковый на B', tailB, tailA);
  const fa2 = sorted(await exprs(A));

  // 8. восстановление из файла calc/index.json, скачанного с «GitHub»
  const idx = await A.evaluate(async api => (await fetch(api + '/repos/mrtekhnik/sync/contents/calc/index.json', {headers: {Authorization: 'Bearer test-token', Accept: 'application/vnd.github.raw'}})).text(), MOCK);
  fs.writeFileSync(TMP + '/index.json', idx);
  const Cdev = await device('C', false);
  await Cdev.click('#menuBtn'); await Cdev.click('#moreBtn');
  const [fc] = await Promise.all([Cdev.waitForEvent('filechooser'), Cdev.click('#dlg .mi[data-r="rs"]')]);
  await fc.setFiles(TMP + '/index.json');
  await Cdev.waitForSelector('#dlg:not(.hidden) .btns .pri');
  eq('8: распознан файл синхронизации', (await Cdev.textContent('#dlg .txt')).startsWith('файл синхронизации GitHub'), true);
  await Cdev.click('#dlg .btns .pri');
  eq('8: восстановлено из index.json', sorted(await exprs(Cdev)), fa2);
  // повреждённый файл не принимается
  fs.writeFileSync(TMP + '/bad.json', JSON.stringify({items: {x: {id: 'x', expr: ['@'], pos: 1, upd: 1}}}));
  await Cdev.click('#menuBtn'); await Cdev.click('#moreBtn');
  const [fc2] = await Promise.all([Cdev.waitForEvent('filechooser'), Cdev.click('#dlg .mi[data-r="rs"]')]);
  await fc2.setFiles(TMP + '/bad.json');
  await Cdev.waitForSelector('#dlg:not(.hidden)');
  eq('8: повреждённый файл отклонён', (await Cdev.textContent('#dlg .txt')).includes('повреждён'), true);
  await Cdev.click('#dlg .btns .pri');
  // обычная резервная копия: создать и восстановить с совпадениями «добавить копией»
  const [dl] = await Promise.all([A.waitForEvent('download'), (async () => { await A.click('#menuBtn'); await A.click('#moreBtn'); await A.click('#dlg .mi[data-r="bk"]'); })()]);
  await dl.saveAs(TMP + '/backup.json');
  const nA = (await exprs(A)).length;
  await A.click('#menuBtn'); await A.click('#moreBtn');
  const [fc3] = await Promise.all([A.waitForEvent('filechooser'), A.click('#dlg .mi[data-r="rs"]')]);
  await fc3.setFiles(TMP + '/backup.json');
  await A.waitForSelector('#dlg .mi[data-r="copy"]');
  eq('8: совпадения найдены', (await A.textContent('#dlg .txt')).includes(`Совпадают с уже имеющимися: ${nA}`), true);
  await A.click('#dlg .mi[data-r="skip"]');
  eq('8: «пропустить» ничего не задвоил', (await exprs(A)).length, nA);

  // ошибка сети: данные не меняются
  await B.evaluate(() => localStorage.setItem('mrtekhnik.sync.api', 'http://127.0.0.1:9'));
  await type(B, '5+5\n');
  const before = await exprs(B);
  const er = await sync(B);
  eq('нет сети: понятное сообщение', er.includes('Нет связи с GitHub'), true);
  eq('нет сети: данные не изменены', await exprs(B), before);

  eq('ошибок JS нет', errors, []);
  await browser.close();
  console.log(`\nСинхронизация: пройдено ${ok}, ошибок ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
