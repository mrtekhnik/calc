// Проверка интерфейса в Chrome: node tests/ui.test.js <url приложения> <папка для снимков> [<url tests/host.html — проверка внутри лаунчера>]
const {chromium} = require('/opt/npm-tools/node_modules/playwright');
const URL = process.argv[2], OUT = process.argv[3];
let ok = 0, fail = 0;
const eq = (n, g, e) => { if (JSON.stringify(g) === JSON.stringify(e)) ok++; else { fail++; console.log('✗', n, '\n   получено:', JSON.stringify(g), '\n   ожидалось:', JSON.stringify(e)); } };
// пункт меню, который может быть спрятан под «Ещё»
const mi = async (page, k) => { const sel = `#dlg .mi[data-r="${k}"]`; if (!(await page.isVisible(sel)) && await page.$('#moreBtn')) await page.click('#moreBtn'); await page.click(sel); };
const clean = s => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
  const errors = [];

  /* ---------- телефон ---------- */
  const phone = await browser.newContext({viewport: {width: 393, height: 780}, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true});
  const p = await phone.newPage();
  p.on('pageerror', e => errors.push('phone: ' + e.message));
  await p.goto(URL);
  const tap = async k => p.click(`#pad [data-k="${k}"]:visible`);
  const typeKeys = async s => { for (const ch of s) await tap(ch === ',' ? '.' : ch === '*' ? '×' : ch === '/' ? '÷' : ch); };
  const lineTexts = () => p.$$eval('#lines .ln:not(.draft)', ns => ns.map(n => n.textContent));
  const draftText = () => p.$eval('.ln.draft', n => n.textContent);

  const draftSel = () => p.$$eval('.ln.draft .sel', ns => ns.map(n => n.textContent));
  await typeKeys('150000');
  eq('подсветка числа при вводе', (await draftSel()).map(clean), ['150000']);
  await tap('×');
  eq('подсветка знака при вводе', await draftSel(), ['×']);
  await typeKeys('0,155');
  eq('подсветка второго числа', await draftSel(), ['0,155']);
  await p.screenshot({path: OUT + '/phone-0-typing.png'});
  await tap('=');
  await tap('-'); await typeKeys('23'); await tap('%'); await tap('=');   // продолжение от результата
  await tap('÷'); await typeKeys('5,5'); await tap('=');
  await tap('+'); await typeKeys('68'); await tap('=');
  let L = (await lineTexts()).map(clean);
  eq('строка 1', L[0], '150000 × 0,155 = 23 250'); // разрядные промежутки в выражении — отступом, не пробелом
  eq('строка 2', L[1], '23 250 − 23% = 17 902,5');
  eq('строка 4', L[3], '3 255 + 68 = 3 323');
  eq('ссылки выделены', await p.$$eval('#lines .ref', ns => ns.length), 3);
  await p.screenshot({path: OUT + '/phone-1-history.png'});

  // правка числа в первой строке: нажать на 155 → выделение → ввести 2 → всё пересчиталось
  const firstLine = p.locator('#lines .ln').nth(0);
  await firstLine.locator('.d').nth(9).click(); // цифра в «0,155»
  eq('число выделено', await p.$$eval('.num.sel', ns => ns.map(n => n.textContent)), ['0,155']);
  await p.screenshot({path: OUT + '/phone-2-selected.png'});
  await tap('7');
  eq('цифра дописана в конец', clean((await lineTexts())[0]).replace(/\s/g, '').split('=')[0], '150000×0,1557');
  eq('выделение сохраняется', await p.$$eval('.num.sel', ns => ns.map(n => n.textContent)), ['0,1557']);
  for (let i = 0; i < 4; i++) await tap('back');
  eq('backspace по одному знаку', clean((await lineTexts())[0]).replace(/\s/g, '').split('=')[0], '150000×0,');
  await typeKeys('2');
  L = (await lineTexts()).map(clean);
  eq('правка строки 1', L[0].replace(/\s/g, ''), '150000×0,2=30000');
  eq('пересчёт строки 4', L[3], '4 200 + 68 = 4 268');
  await p.screenshot({path: OUT + '/phone-3-edited.png'});
  // второе нажатие по числу — курсор внутри
  await firstLine.locator('.d').nth(0).click(); // «1» в 150000: первое нажатие выделяет число
  await p.waitForTimeout(450); // быстрое двойное нажатие копирует, курсор — вторым нажатием чуть позже
  await firstLine.locator('.d').nth(0).click({position: {x: 1, y: 10}}); // второе — курсор перед «1»
  eq('курсор в числе', await p.$$eval('#lines .ln.act .caret', ns => ns.length), 1);
  await tap('2');
  L = (await lineTexts()).map(clean);
  eq('вставка цифры в начало', L[0].replace(/\s/g, ''), '2150000×0,2=430000');
  await tap('='); // конец правки
  eq('правка закончена', await p.$$eval('#lines .ln.act:not(.draft)', ns => ns.length), 0);

  // отмена правки
  await p.click('#undoBtn');
  L = (await lineTexts()).map(clean);
  eq('отмена → 0,155 обратно', L[0].replace(/\s/g, ''), '150000×0,155=23250');
  eq('отмена → строка 4', L[3], '3 255 + 68 = 3 323');
  await p.click('#redoBtn');
  L = (await lineTexts()).map(clean);
  eq('повтор', L[0].replace(/\s/g, ''), '2150000×0,2=430000');
  await p.click('#undoBtn');

  // нажатие на результат вставляет ссылку в строку ввода
  await p.locator('#lines .ln').nth(1).locator('.res').click();
  await tap('×'); await typeKeys('2');
  eq('предпросмотр', clean(await draftText()), '17 902,5 × 2= 35 805');
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="hlIn"] button[data-v="false"]'); await p.click('#dlg .btns .pri');
  eq('подсветка выключена', await draftSel(), []);
  eq('курсор вместо подсветки', await p.$$eval('.ln.draft .caret', ns => ns.length), 1);
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="hlIn"] button[data-v="true"]'); await p.click('#dlg .btns .pri');
  await tap('=');
  // цикл запрещён: правим строку 1, пытаемся вставить результат строки 2 (она зависит от 1)
  await firstLine.locator('.op').click();
  await p.locator('#lines .ln').nth(1).locator('.res').click();
  eq('цикл не создан', clean((await lineTexts())[0]).replace(/\s/g, ''), '150000×0,155=23250');
  eq('сообщение о цикле', (await p.textContent('#toast')).includes('цикл'), true);
  await tap('=');

  // ошибка в строке не ломает историю
  await typeKeys('5/0'); await tap('=');
  L = (await lineTexts()).map(clean);
  eq('деление на ноль', L[L.length - 1], '5 ÷ 0 = Деление на ноль');

  // удаление строки 2 через долгое нажатие: в строке 3 остаётся число
  await p.locator('#lines .ln').nth(1).click({button: 'right'});
  eq('меню строки: «Удалить» сверху', await p.isVisible('#dlg .mi[data-r="del"]'), true);
  await mi(p, 'del');
  await p.click('#dlg .btns .dng');
  L = (await lineTexts()).map(clean);
  eq('после удаления', L[1], '17902,5 ÷ 5,5 = 3 255');
  eq('ссылка стала числом', await p.locator('#lines .ln').nth(1).locator('.ref').count(), 0);
  await p.click('#undoBtn');
  L = (await lineTexts()).map(clean);
  eq('удаление отменено', L[1], '23 250 − 23% = 17 902,5');

  // убрать ссылку: долгое нажатие на зелёное число в строке 3
  await p.locator('#lines .ln').nth(2).locator('.ref').click({button: 'right'});
  await mi(p, 'un1');
  eq('ссылка убрана', await p.locator('#lines .ln').nth(2).locator('.ref').count(), 0);
  eq('значение то же', clean((await lineTexts())[2]), '17902,5 ÷ 5,5 = 3 255');
  await firstLine.locator('.d').nth(9).click(); await tap('back'); await tap('2'); await tap('=');
  L = (await lineTexts()).map(clean);
  eq('строка 2 пересчиталась', L[1], '22 800 − 23% = 17 556');
  eq('отвязанная строка не изменилась', L[2], '17902,5 ÷ 5,5 = 3 255');
  await p.click('#undoBtn'); await p.click('#undoBtn');
  eq('отмена: ссылка вернулась', await p.locator('#lines .ln').nth(2).locator('.ref').count(), 1);
  // отвязать все строки, которые ссылаются на строку 1
  await p.locator('#lines .ln').nth(0).click({button: 'right'});
  await mi(p, 'unD');
  eq('строка 2 отвязана', await p.locator('#lines .ln').nth(1).locator('.ref').count(), 0);
  await p.click('#undoBtn');
  eq('отмена отвязки', await p.locator('#lines .ln').nth(1).locator('.ref').count(), 1);

  // выделить число в истории и нажать «=» — число переносится в строку ввода
  await p.locator('#lines .ln').nth(3).locator('.d').last().click(); // «8» в «68»
  await tap('=');
  eq('перенос числа по «=»', clean(await draftText()), '68');
  eq('правка закончена после переноса', await p.$$eval('#lines .ln.act', ns => ns.length), 0);
  await tap('+');
  await p.locator('#lines .ln').nth(0).locator('.d').nth(8).click(); // «1» в «0,155»
  await tap('=');
  eq('перенос после действия', clean(await draftText()).split('=')[0].trim(), '68 + 0,155');
  await tap('C');
  // знак при вставке после числа: по умолчанию «+», настройкой — «×» или замена
  const setJoin = async v => { await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click(`#dlg .seg[data-s="join"] button[data-v="${v}"]`); await p.click('#dlg .btns .pri'); };
  await typeKeys('5'); await p.locator('#lines .ln').nth(3).locator('.d').last().click(); await tap('=');
  eq('вставка после числа: «+» по умолчанию', clean(await draftText()).split('=')[0].trim(), '5 + 68');
  await tap('C'); await setJoin('×');
  await typeKeys('5'); await p.locator('#lines .ln').nth(1).locator('.res').click();
  eq('вставка результата после числа: «×»', clean(await draftText()).split('=')[0].trim(), '5 × 17 902,5');
  await tap('C'); await setJoin('replace');
  await typeKeys('5'); await p.locator('#lines .ln').nth(1).locator('.res').click();
  eq('вставка после числа: заменить', clean(await draftText()), '17 902,5');
  await tap('C'); await setJoin('+');
  // если число исправили, «=» только заканчивает правку
  await p.locator('#lines .ln').nth(3).locator('.d').last().click(); await tap('9'); await tap('=');
  eq('после правки не переносится', clean(await draftText()), '0');
  await p.click('#undoBtn');
  // долгое нажатие на число: копировать и вставить в строку ввода
  await phone.grantPermissions(['clipboard-read', 'clipboard-write']);
  // двойное нажатие — копировать: число в строке, результат (вставка в ввод отменяется), предпросмотр
  const clip = () => p.evaluate(() => navigator.clipboard.readText());
  await p.locator('#lines .ln').nth(0).locator('.d').nth(8).dblclick();
  eq('двойной тап по числу — скопировано', await clip(), '0,155');
  await p.waitForTimeout(450); await p.click('.ln.draft');
  await p.locator('#lines .ln').nth(1).locator('.res').dblclick();
  eq('двойной тап по результату — скопировано', await clip(), '17902,5');
  eq('двойной тап по результату — в строку ввода ничего не вставлено', clean(await draftText()), '0');
  await p.locator('#lines .ln').nth(2).locator('.ref').dblclick();
  eq('двойной тап по ссылке — скопировано', await clip(), '17902,5');
  await p.waitForTimeout(450); await p.click('.ln.draft');
  await typeKeys('2*3'); await p.locator('.ln.draft .pv').dblclick();
  eq('двойной тап по предпросмотру — скопировано', await clip(), '6');
  await tap('C');
  await p.waitForTimeout(450);
  await p.locator('#lines .ln').nth(0).locator('.d').nth(8).click({button: 'right'});
  eq('пункты меню числа', await p.$$eval('#dlg .mi', ns => ns.slice(0, 2).map(n => n.textContent)), ['Копировать число 0,155', 'Вставить число в строку ввода']);
  await p.click('#dlg .mi[data-r="pc"]');
  eq('скопировано число', await p.evaluate(() => navigator.clipboard.readText()), '0,155');
  await p.locator('#lines .ln').nth(0).locator('.d').nth(8).click({button: 'right'});
  await p.click('#dlg .mi[data-r="pd"]');
  eq('вставлено число', clean(await draftText()), '0,155');
  await tap('C');
  // долгое нажатие на ссылку: вставить ссылкой
  await p.locator('#lines .ln').nth(3).locator('.ref').click({button: 'right'});
  await p.click('#dlg .mi[data-r="pd"]');
  eq('вставлена ссылка', await p.$$eval('.ln.draft .ref', ns => ns.length), 1);
  await tap('C');

  // ⌫: стереть строку целиком и нажать ещё раз — строка удалена (с «Вернуть»)
  const nB = (await lineTexts()).length, txtB = clean((await lineTexts())[2]);
  await p.locator('#lines .ln').nth(2).locator('.eqs').click();
  const nAt = await p.evaluate(() => ed.atoms.length);
  for (let i = 0; i < nAt; i++) await tap('back');
  eq('⌫: строка пустая, подсказка', (await p.textContent('#lines .ln.act')).includes('будет удалена'), true);
  await tap('back');
  eq('⌫ на пустой строке — удалена', (await lineTexts()).length, nB - 1);
  await p.click('#tUndo');
  eq('«Вернуть» — строка с исходным содержимым', [(await lineTexts()).length, clean((await lineTexts())[2])], [nB, txtB]);
  // удержание ⌫ на строке истории — удалить; в строке ввода — очистить
  const backXY = async () => { const b = await p.locator('#topRow [data-k="back"]').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  await p.waitForTimeout(450);
  await p.locator('#lines .ln').nth(2).locator('.eqs').click();
  let [bx, by] = await backXY();
  await p.mouse.move(bx, by); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up();
  eq('удержание ⌫: строка удалена', (await lineTexts()).length, nB - 1);
  await p.click('#tUndo');
  eq('удержание ⌫: «Вернуть»', [(await lineTexts()).length, clean((await lineTexts())[2])], [nB, txtB]);
  await typeKeys('123');
  await p.mouse.move(bx, by); await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up();
  eq('удержание ⌫ в строке ввода — очищена', clean(await draftText()), '0');
  eq('удержание ⌫ в строке ввода — история цела', (await lineTexts()).length, nB);
  // метла при правке строки истории не стирает её
  await p.waitForTimeout(450);
  await p.locator('#lines .ln').nth(2).locator('.d').last().click(); await tap('9'); await tap('C');
  eq('метла: правка закончена, строка не стёрта', [await p.$$eval('#lines .ln.act', ns => ns.length), clean((await lineTexts())[2]).includes('5,59')], [0, true]);
  await p.click('#undoBtn');
  eq('метла: ↶ отменил правку', clean((await lineTexts())[2]), txtB);

  // вставка строки выше
  await p.locator('#lines .ln').nth(1).click({button: 'right'});
  await mi(p, 'above');
  await typeKeys('2+2'); await tap('=');
  L = (await lineTexts()).map(clean);
  eq('строка выше', L[1], '2 + 2 = 4');
  eq('всего строк', L.length, 7);

  // функции: свайп по клавиатуре
  const swipe = async () => { const b = await (await p.$('#grids')).boundingBox();
    await p.mouse.move(b.x + b.width * 0.8, b.y + 50); await p.mouse.down(); await p.mouse.move(b.x + b.width * 0.2, b.y + 55, {steps: 5}); await p.mouse.up(); };
  await swipe();
  eq('панель функций', await p.$eval('#gSci', n => !n.classList.contains('off')), true);
  await p.screenshot({path: OUT + '/phone-4-functions.png'});
  await tap('√'); await p.click('#pad [data-k="123"]'); await typeKeys('16'); await tap('+'); await typeKeys('3');
  await swipe(); await tap('²'); await tap('=');
  L = (await lineTexts()).map(clean);
  eq('функции', L[L.length - 1], '√16 + 3x²'.replace('x²', '²') + ' = 13');
  await swipe();
  eq('цифры после свайпа', await p.$eval('#gNum', n => !n.classList.contains('off')), true);

  const rowH = async () => p.evaluate(() => [document.querySelector('#topRow').getBoundingClientRect().height, document.querySelector('#gNum [data-k="7"]').getBoundingClientRect().height]);
  let [h1, h2] = await rowH();
  eq('верхний ряд как остальные', Math.abs(h1 - h2) < 2, true);
  eq('высота клавиатуры обычная ≈47%', Math.round(await p.$eval('#pad', n => n.getBoundingClientRect().height) / 780 * 100), 47);
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="kb"] button[data-v="40"]'); await p.click('#dlg .btns .pri');
  eq('высота клавиатуры ниже 40%', Math.round(await p.$eval('#pad', n => n.getBoundingClientRect().height) / 780 * 100), 40);
  await p.screenshot({path: OUT + '/phone-11-kb40.png'});
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true));
  for (let i = 0; i < 3; i++) await p.click('#dlg [data-kst="+"]');
  eq('точная высота: число', await p.textContent('#kbV'), '43%');
  eq('точная высота: кнопки без выбора', await p.$$eval('#dlg .seg[data-s="kb"] button.on', ns => ns.length), 0);
  eq('точная высота 43%', Math.round(await p.$eval('#pad', n => n.getBoundingClientRect().height) / 780 * 100), 43);
  await p.screenshot({path: OUT + '/phone-12-settings.png'});
  for (let i = 0; i < 50; i++) await p.click('#dlg [data-kst="-"]');
  eq('нижний предел 30%', await p.textContent('#kbV'), '30%');
  await p.click('#dlg .seg[data-s="kb"] button[data-v="54"]');
  eq('пресет обновил число', await p.textContent('#kbV'), '54%');
  await p.click('#dlg .btns .pri');
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="kb"] button[data-v="47"]'); await p.click('#dlg .btns .pri');

  // удержание «0»: нули повторяются; удержание «00»: ряд вариантов
  const center = async sel => { const b = await p.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  await typeKeys('7');
  let [zx, zy] = await center('#gNum [data-k="0"]');
  await p.mouse.move(zx, zy); await p.mouse.down(); await p.waitForTimeout(1000); await p.mouse.up();
  await p.waitForTimeout(100);
  const zr = clean(await draftText()).replace(/\s/g, '');
  eq('удержание 0: несколько нулей (≥3)', /^70{3,4}$/.test(zr), true);
  eq('удержание 0: панель функций не открылась', await p.$eval('#gNum', n => !n.classList.contains('off')), true);
  await tap('C'); await typeKeys('5');
  [zx, zy] = await center('#gNum [data-k="00"]');
  await p.mouse.move(zx, zy); await p.mouse.down(); await p.waitForTimeout(600);
  eq('удержание 00: ряд вариантов', await p.$$eval('#zPop div', ns => ns.map(n => n.textContent)), ['000', '0000', '00000', '000000']);
  await p.screenshot({path: OUT + '/phone-20-zeros.png'});
  const last = await p.locator('#zPop div').nth(3).boundingBox();
  await p.mouse.move(last.x + last.width / 2, last.y + last.height / 2, {steps: 6}); await p.mouse.up();
  await p.waitForTimeout(100);
  eq('удержание 00: выбран 000000', clean(await draftText()).replace(/\s/g, ''), '5000000');
  eq('удержание 00: ряд закрылся', await p.$$eval('#zPop', ns => ns.length), 0);
  await tap('C'); await typeKeys('8');
  await p.mouse.move(zx, zy); await p.mouse.down(); await p.waitForTimeout(600); await p.mouse.up(); await p.waitForTimeout(100);
  eq('удержание 00: отпустить сразу — 000', clean(await draftText()).replace(/\s/g, ''), '8000');
  await tap('C'); await typeKeys('9');
  await p.mouse.move(zx, zy); await p.mouse.down(); await p.waitForTimeout(600); await p.mouse.move(zx, zy + 160, {steps: 6}); await p.mouse.up(); await p.waitForTimeout(100);
  eq('удержание 00: увести вниз — отмена', clean(await draftText()), '9');
  await tap('00');
  eq('короткое нажатие 00 как раньше', clean(await draftText()).replace(/\s/g, ''), '900');
  await tap('C');

  // свернуть клавиатуру
  await tap('tog');
  eq('клавиатура свёрнута', await p.$eval('#pad', n => n.classList.contains('min')), true);
  await p.screenshot({path: OUT + '/phone-5-collapsed.png'});
  await tap('tog');

  // темы
  await p.click('#menuBtn'); await mi(p, 'th');
  await p.screenshot({path: OUT + '/phone-6-themes.png', fullPage: false});
  await p.click('#dlg .th[data-t="classic"]');
  await p.click('#dlg .btns .pri');
  await p.screenshot({path: OUT + '/phone-7-classic.png'});
  await p.click('#menuBtn'); await mi(p, 'th'); await p.click('#dlg .th[data-t="sunset"]'); await p.click('#dlg .btns .pri');
  await p.screenshot({path: OUT + '/phone-8-sunset.png'});

  // настройки: точка как разделитель
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true));
  await p.click('#dlg .seg[data-s="sep"] button[data-v="."]');
  await p.click('#dlg .btns .pri');
  L = (await lineTexts()).map(clean);
  eq('разделитель точка', L[0], '150000 × 0.155 = 23 250');
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="sep"] button[data-v=","]'); await p.click('#dlg .btns .pri');

  // предпросмотр результата не прячется за клавиатурой, даже если прокрутить историю вверх
  await p.$eval('#tape', n => n.scrollTop = 0);
  await typeKeys('12*3');
  const vis = await p.evaluate(() => { const pv = document.querySelector('.ln.draft .pv').getBoundingClientRect(), tp = document.querySelector('#tape').getBoundingClientRect(); return pv.bottom <= tp.bottom + 1 && pv.top >= tp.top; });
  eq('предпросмотр виден', vis, true);
  await p.screenshot({path: OUT + '/phone-13-preview.png'});
  await tap('C');

  // округление: вверх(12,1; 0,5)
  await swipe(); await tap('rup'); await tap('123'); await typeKeys('12,1'); await swipe(); await tap(';'); await tap('123'); await typeKeys('0,5'); await tap('=');
  L = (await lineTexts()).map(clean);
  eq('округление вверх', L[L.length - 1], 'вверх(12,1; 0,5) = 12,5');
  // выделение строк и сумма
  await p.locator('#lines .ln').nth(2).click({button: 'right'});
  await mi(p, 'sum');
  await p.locator('#lines .ln').nth(3).click(); await p.locator('#lines .ln').nth(4).click();
  eq('сумма выделенных', clean(await p.textContent('#selBar .st')), 'Выбрано: 3 · Σ 24 480,5 · ср. 8 160,1667 · мин 3 255 · макс 17 902,5');
  await p.screenshot({path: OUT + '/phone-17-sum.png'});
  await p.click('#selBar [data-s="sum"]');
  eq('Σ в ввод ссылками', await p.$$eval('.ln.draft .ref', ns => ns.length), 3);
  eq('Σ предпросмотр', clean(await p.$eval('.ln.draft .pv', n => n.textContent)), '= 24 480,5');
  await tap('C');
  // подбор числа: чтобы строка 1 дала 31 000
  await p.locator('#lines .ln').nth(0).locator('.d').nth(8).click({button: 'right'});
  await mi(p, 'seek');
  await p.fill('#gsV', '31000'); await p.click('#dlg .btns .pri');
  L = (await lineTexts()).map(clean);
  eq('подбор: результат', L[0].split('=')[1].trim(), '31 000');
  eq('подбор: зависимая пересчиталась', L[2].split('=')[1].trim(), '23 870');
  // подбор по зависимой строке: строка 3 (÷ 5,5) должна дать 4 000
  await p.locator('#lines .ln').nth(0).locator('.d').nth(8).click({button: 'right'});
  await mi(p, 'seek');
  await p.locator('#dlg input[name=gsT]').nth(2).check();
  await p.fill('#gsV', '4000'); await p.click('#dlg .btns .pri');
  L = (await lineTexts()).map(clean);
  eq('подбор по зависимой', L[3].split('=')[1].trim(), '4 000');
  await p.click('#undoBtn'); await p.click('#undoBtn');
  L = (await lineTexts()).map(clean);
  eq('подбор отменён', L[0].replace(/\s/g, ''), '150000×0,155=23250');

  // меню строки: сверху важное, остальное под «Ещё»
  await p.locator('#lines .ln').nth(1).click({button: 'right'});
  eq('меню: сверху', await p.$$eval('#dlg > .box > .mi:not(.mo)', ns => ns.map(n => n.textContent)), ['Вставить результат в строку ввода', 'Копировать результат', 'Править строку', 'Удалить строку', 'Выбрать строки (удалить, копировать…)']);
  eq('меню: «Ещё» скрыто', await p.isVisible('#dlg .mi[data-r="pin"]'), false);
  await p.click('#moreBtn');
  eq('меню: «Ещё» раскрыто', await p.isVisible('#dlg .mi[data-r="pin"]'), true);
  await p.screenshot({path: OUT + '/phone-18-menu.png'});
  await p.keyboard.press('Escape');
  // округлить результат строки через меню: 2 + 2 → нет; строка 3 (17 902,5 ÷ 5,5 = 3 255) вверх до 100
  await p.locator('#lines .ln').nth(3).click({button: 'right'});
  await mi(p, 'rnd');
  await p.click('#rFn [data-f="rup"]'); await p.click('#dlg [data-st="100"]');
  eq('округление: пояснение «вверх»', (await p.textContent('#rHow')).startsWith('Всегда в большую сторону'), true);
  eq('округление: предпросмотр', (await p.textContent('#rRes')).startsWith('Будет: 3' + String.fromCharCode(0x202F) + '300'), true);
  await p.screenshot({path: OUT + '/phone-19-round.png'});
  await p.click('#dlg .btns .pri');
  L = (await lineTexts()).map(clean);
  eq('округление результата строки', L[3].split('=').pop().trim(), '3 300');
  await p.click('#undoBtn');
  // клавиша «окр» после выражения оборачивает его
  await typeKeys('12,34*3'); await swipe(); await tap('rnd'); await tap('123');
  eq('окр по выражению: подсказка', clean(await p.$eval('.ln.draft .pv', n => n.textContent)).includes('введите шаг'), true);
  eq('окр по выражению: без всплывающей подсказки', await p.$eval('#toast', n => n.classList.contains('hidden') || !n.textContent.includes('шаг')), true);
  await typeKeys('0,5'); await tap('=');
  L = (await lineTexts()).map(clean);
  eq('окр по выражению', L[L.length - 1], 'окр(12,34 × 3; 0,5) = 37');
  await p.click('#undoBtn');

  // подписи, вставка по подписи, закреплённые, поиск, номера, разделители по дням
  eq('разделитель «Сегодня»', await p.$$eval('#lines .hdr', ns => ns.map(n => n.textContent)), ['Сегодня']);
  await p.locator('#lines .ln').nth(0).click({button: 'right'});
  await mi(p, 'lbl');
  await p.fill('#pIn', 'лист 2 мм'); await p.click('#dlg .btns .pri');
  eq('подпись показана', await p.locator('#lines .ln').nth(0).locator('.lbl').textContent(), 'лист 2 мм');
  await swipe(); await tap('pick');
  await p.fill('#pkIn', 'лист');
  eq('выбор по подписи: найдено', await p.$$eval('#dlg .pk[data-r^="p:"]', ns => ns.length), 1);
  await p.click('#dlg .pk');
  eq('вставлено по подписи', (await p.$$eval('.ln.draft .ref', ns => ns.map(n => n.textContent))).map(clean), ['23 250']);
  await tap('C'); await swipe();
  await p.locator('#lines .ln').nth(0).click({button: 'right'});
  await mi(p, 'pin');
  eq('закреплено', clean(await p.textContent('#pins')), 'лист 2 мм23 250');
  await p.screenshot({path: OUT + '/phone-14-pins.png'});
  await p.click('#pins .pin');
  eq('нажатие на закреплённое вставляет ссылку', await p.$$eval('.ln.draft .ref', ns => ns.length), 1);
  await tap('C');
  await p.click('#undoBtn');
  eq('отмена закрепления', await p.$eval('#pins', n => n.classList.contains('hidden')), true);
  await p.click('#findBtn'); await p.fill('#q', '17902,5');
  eq('поиск по числу', await p.$$eval('#lines .ln.found', ns => ns.length), 3);
  eq('поиск: счётчик', await p.textContent('#qCnt'), 'найдено: 3');
  await p.fill('#q', 'лист');
  eq('поиск по подписи', await p.$$eval('#lines .ln.found', ns => ns.length), 1);
  await p.screenshot({path: OUT + '/phone-15-search.png'});
  await p.click('#qClose');
  eq('поиск закрыт — все строки', await p.$$eval('#lines .ln.hidden', ns => ns.length), 0);
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="nums"] button[data-v="true"]'); await p.click('#dlg .btns .pri');
  eq('номера строк', await p.$$eval('#lines .no', ns => ns.slice(0, 3).map(n => n.textContent)), ['1', '2', '3']);
  await p.screenshot({path: OUT + '/phone-16-nums.png'});
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="nums"] button[data-v="false"]'); await p.click('#dlg .btns .pri');
  eq('телефон: высота клавиатуры в процентах и размер знаков', await p.evaluate(() => { settingsDlg(); const r = [[...document.querySelectorAll('#dlg .seg[data-s="kb"] button')].map(b => b.textContent).join(' '), !!document.querySelector('#dlg .seg[data-s="keyZoom"]'), !!document.querySelector('#dlg .seg[data-s="kbWd"]')]; closeDlg(null); return r; }), ['ниже обычная выше макс.', true, false]);
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true));
  const zoomP = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim());
  eq('телефон: размер цифр — точно, начало от выбранного', await p.textContent('#pzV'), '100%');
  await p.click('#dlg [data-pzst="+"]');
  eq('телефон: размер цифр 105 %', [await p.textContent('#pzV'), await zoomP(), await p.$$eval('#dlg .seg[data-s="size"] button.on', ns => ns.length)], ['105%', '1.05', 0]);
  await p.click('#dlg .seg[data-s="size"] button[data-v="l"]');
  eq('телефон: «крупный» сбрасывает точную подстройку', [await p.textContent('#pzV'), await zoomP()], ['118%', '1.18']);
  await p.click('#dlg .seg[data-s="size"] button[data-v="m"]');
  await p.click('#dlg .btns .pri');
  eq('телефон: размер цифр — три варианта, как было', await p.evaluate(() => { settingsDlg(); const ok = !!document.querySelector('#dlg .seg[data-s="size"]') && !document.querySelector('#dlg .seg[data-s="pcZoom"]'); closeDlg(null); return ok; }), true);
  // подписи можно выключить
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="labels"] button[data-v="false"]'); await p.click('#dlg .btns .pri');
  eq('подписи выключены', await p.$$eval('#lines .lbl', ns => ns.length), 0);
  await p.locator('#lines .ln').nth(0).click({button: 'right'});
  eq('пункта «Подпись» нет', await p.$$eval('#dlg .mi[data-r="lbl"]', ns => ns.length), 0);
  await p.keyboard.press('Escape');
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await p.click('#dlg .seg[data-s="labels"] button[data-v="true"]'); await p.click('#dlg .btns .pri');
  eq('подписи снова видны', await p.$$eval('#lines .lbl', ns => ns.map(n => n.textContent)), ['лист 2 мм']);

  // история сохраняется после перезапуска
  await p.reload();
  L = (await lineTexts()).map(clean);
  eq('после перезапуска строк', L.length, 9);
  eq('после перезапуска тема', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()), '#ffe08a');
  eq('ключи хранилища с префиксом', await p.evaluate(() => Object.keys(localStorage).every(k => k.startsWith('calc:'))), true);

  // горизонтальная ориентация телефона
  await p.setViewportSize({width: 780, height: 393});
  await p.click('#menuBtn'); await mi(p, 'th'); await p.click('#dlg .th[data-t="dark"]'); await p.click('#dlg .btns .pri');
  await p.screenshot({path: OUT + '/phone-9-landscape.png'});
  await p.setViewportSize({width: 393, height: 780});
  await p.screenshot({path: OUT + '/phone-10-dark.png'});

  /* ---------- ПК ---------- */
  const pc = await browser.newContext({viewport: {width: 1280, height: 720}});
  await pc.grantPermissions(['clipboard-read', 'clipboard-write']);
  const d = await pc.newPage();
  d.on('pageerror', e => errors.push('pc: ' + e.message));
  await d.goto(URL);
  await d.evaluate(() => localStorage.clear()); await d.reload();
  const kb = async s => { for (const ch of s) await d.keyboard.press(ch === '\n' ? 'Enter' : ch); };
  await kb('120*1,2+45*1,5\n');
  await kb('72/4\n');
  await d.keyboard.press('NumpadAdd'); await d.keyboard.press('Numpad2'); await d.keyboard.press('NumpadEnter');
  await kb('2^10\n');
  const dl = async () => (await d.$$eval('#lines .ln:not(.draft)', ns => ns.map(n => n.textContent))).map(clean);
  L = await dl();
  eq('ПК строка 1', L[0], '120 × 1,2 + 45 × 1,5 = 211,5');
  eq('ПК продолжение с цифрового блока', L[2], '18 + 2 = 20');
  eq('ПК степень', L[3], '2 ^ 10 = 1 024');
  // новый расчёт: следующая строка отделяется чертой
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="brk"]');
  eq('ПК: ожидающий разделитель', await d.$$eval('#lines .hdr', ns => ns.map(n => n.textContent)), ['Сегодня', 'новый расчёт']);
  await kb('7*6\n');
  eq('ПК: разделитель у новой строки', await d.$$eval('#lines .hdr', ns => ns.map(n => n.textContent)), ['Сегодня', 'новый расчёт']);
  eq('ПК: разделитель стоит перед 7×6', clean(await d.$$eval('#lines .hdr', ns => ns[1].nextElementSibling.textContent)), '7 × 6 = 42');
  await d.click('#undoBtn');
  // подпись и вставка по подписи буквами с клавиатуры
  await d.locator('#lines .ln').nth(3).click({button: 'right'});
  await mi(d, 'lbl'); await d.fill('#pIn', 'степень'); await d.keyboard.press('Enter');
  await d.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'с', bubbles: true}))); // русская «с»
  eq('ПК: буква открыла выбор', await d.$eval('#pkIn', n => n.value), 'с');
  await d.keyboard.insertText('т'); await d.keyboard.press('Enter');
  await kb('+1\n');
  eq('ПК: вставка по подписи', (await dl())[4], '1 024 + 1 = 1 025');
  await d.click('#undoBtn');
  // Ctrl+F
  await d.keyboard.press('Control+f');
  eq('ПК: Ctrl+F открыл поиск', await d.evaluate(() => document.activeElement.id), 'q');
  await d.keyboard.type('211'); 
  eq('ПК: найдено', await d.$$eval('#lines .ln.found', ns => ns.length), 1);
  await d.keyboard.press('Escape');
  eq('ПК: Esc закрыл поиск', await d.$eval('#search', n => n.classList.contains('hidden')), true);

  // строка, созданная позавчера, при правке остаётся в своём дне и получает отметку «изм.»
  // делаем первую строку «позавчерашней» прямо в приложении (при перезагрузке оно само сохраняет историю)
  await d.evaluate(() => { const l = vis()[0]; l.at = l.upd = Date.now() - 2 * 864e5 - 3600e3; saveNow(); });
  await d.reload();
  const hdrs = await d.$$eval('#lines .hdr', ns => ns.map(n => n.textContent));
  eq('ПК: старый день отдельно', hdrs.length === 2 && hdrs[1] === 'Сегодня' && /^\d\d\.\d\d\.\d{4}$/.test(hdrs[0]), true);
  await d.locator('#lines .ln').nth(0).locator('.d').first().click(); await d.keyboard.press('2'); await d.keyboard.press('Escape');
  eq('ПК: после правки день тот же', (await d.$$eval('#lines .hdr', ns => ns.map(n => n.textContent)))[0], hdrs[0]);
  eq('ПК: отметка «изм.»', /^изм\. сегодня \d\d:\d\d$/.test(await d.locator('#lines .ln').nth(0).locator('.lbl').textContent()), true);
  await d.click('#undoBtn');

  // стрелки: вверх три раза — строка 72/4, правка, Esc
  await d.keyboard.press('ArrowUp'); await d.keyboard.press('ArrowUp'); await d.keyboard.press('ArrowUp');
  await d.keyboard.press('Backspace'); await d.keyboard.press('8'); await d.keyboard.press('Escape');
  L = await dl();
  eq('ПК правка стрелками', L[1], '72 ÷ 8 = 9');
  eq('ПК зависимая', L[2], '9 + 2 = 11');
  // Shift+Enter: вставить результат выбранной строки в ввод
  await d.keyboard.press('ArrowUp'); await d.keyboard.press('Shift+Enter'); await kb('*3\n');
  L = await dl();
  eq('ПК Shift+Enter', L[4], '1 024 × 3 = 3 072');
  await d.keyboard.press('Control+z');
  eq('ПК Ctrl+Z', (await dl()).length, 4);
  // Enter на строке истории — её результат в строку ввода; Delete на строке — удалить строку
  await d.keyboard.press('Escape');
  const n0 = (await dl()).length;
  await d.keyboard.press('ArrowUp'); await d.keyboard.press('ArrowUp'); await d.keyboard.press('Enter');
  eq('ПК Enter на строке: ссылка в строку ввода', await d.$$eval('.ln.draft .ref', ns => ns.length), 1);
  eq('ПК Enter на строке: строка не изменилась', (await dl()).length, n0);
  await d.keyboard.press('Escape');
  await d.keyboard.press('ArrowUp'); await d.keyboard.press('Delete');
  eq('ПК Delete один раз: строка только подсвечена', [(await dl()).length, await d.$$eval('#lines .ln.delarm', ns => ns.length)], [n0, 1]);
  await d.keyboard.press('ArrowUp');
  eq('ПК другая клавиша отменяет удаление', [(await dl()).length, await d.$$eval('#lines .ln.delarm', ns => ns.length)], [n0, 0]);
  await d.keyboard.press('ArrowDown'); await d.keyboard.press('Delete'); await d.keyboard.press('Delete');
  eq('ПК Delete дважды: удалена', (await dl()).length, n0 - 1);
  eq('ПК после удаления — строка ввода (не следующая строка)', await d.$$eval('#lines .ln.act', ns => ns.length), 0);
  eq('ПК кнопка «Вернуть»', await d.isVisible('#tUndo'), true);
  await d.click('#tUndo');
  eq('ПК «Вернуть» вернул строку', (await dl()).length, n0);
  // стёрли строку целиком и вышли — строка не удаляется, а возвращается
  await d.keyboard.press('ArrowUp');
  const nAtPC = await d.evaluate(() => ed.atoms.length);
  for (let i = 0; i < nAtPC; i++) await d.keyboard.press('Backspace');
  await d.keyboard.press('Escape');
  eq('ПК стёртая строка удалена при выходе', (await dl()).length, n0 - 1);
  await d.click('#tUndo');
  eq('ПК «Вернуть» — строка как была', (await dl()).length, n0);
  // «Выбрать строки»: массовые действия
  {
    const lnN = i => d.locator('#lines .ln:not(.draft)').nth(i);
    const st = async () => clean(await d.textContent('#selBar .st'));
    await lnN(0).click({button: 'right'}); await mi(d, 'sel');
    eq('выбор: режим действий, одна строка', [await st(), await d.isVisible('#selBar [data-s="del"]'), await d.isVisible('#selBar [data-s="sum"]')], ['Выбрано строк: 1', true, false]);
    await lnN(2).click({modifiers: ['Shift']});
    eq('выбор: Shift+клик — диапазон', await st(), 'Выбрано строк: 3');
    await d.keyboard.press('Control+a');
    eq('выбор: Ctrl+A — все', await st(), 'Выбрано строк: ' + n0);
    await d.click('#selBar [data-s="none"]');
    eq('выбор: «Снять»', await d.evaluate(() => picked.size), 0);
    await d.locator('#lines .hdr').last().click();
    eq('выбор: разделитель дня — весь день', await d.evaluate(() => vis().filter(l => picked.has(l.id)).map(l => dayKey(l.at)).join()), await d.evaluate(() => vis().filter(l => dayKey(l.at) === dayKey(Date.now())).map(l => dayKey(l.at)).join()));
    await d.locator('#lines .hdr').last().click();
    eq('выбор: разделитель повторно — снято', await d.evaluate(() => picked.size), 0);
    await lnN(0).click(); await lnN(1).click();
    await d.click('#selBar [data-s="cp"]');
    eq('выбор: копировать строки', (await d.evaluate(() => navigator.clipboard.readText())).split('\n').map(clean), (await dl()).slice(0, 2));
    await d.click('#selBar [data-s="more"]'); await d.click('#dlg .mi[data-r="res"]');
    eq('выбор: копировать только результаты', (await d.evaluate(() => navigator.clipboard.readText())).split('\n').map(clean), (await dl()).slice(0, 2).map(x => x.split(' = ')[1]));
    await d.click('#selBar [data-s="more"]'); await d.click('#dlg .mi[data-r="pin"]');
    eq('выбор: закреплено 2', await d.$$eval('#pins .pin', ns => ns.length), 2);
    await d.click('#undoBtn');
    eq('выбор: ↶ открепил все разом', await d.$$eval('#pins .pin', ns => ns.length), 0);
    await d.keyboard.press('Escape');
    eq('выбор: Esc — выход', await d.isVisible('#selBar'), false);
    // строка со ссылкой на удаляемую
    await d.locator('#lines .ln:not(.draft)').nth(0).locator('.res').click(); await kb('+1\n');
    const nX = (await dl()).length, lastX = (await dl())[nX - 1];
    await lnN(0).click({button: 'right'}); await mi(d, 'sel'); await lnN(1).click();
    await d.keyboard.press('Delete');
    eq('выбор: подтверждение удаления', clean(await d.textContent('#dlg h2')), 'Удалить строк: 2?');
    await d.click('#dlg .btns [data-r="ok"]');
    L = await dl();
    eq('выбор: удалено 2, режим закрыт', [L.length, await d.isVisible('#selBar')], [nX - 2, false]);
    eq('выбор: в зависимой строке осталось число', [L[L.length - 1].split(' = ')[1], await d.evaluate(() => C.refsOf(vis()[vis().length - 1].expr).length)], [lastX.split(' = ')[1], 0]);
    await d.click('#tUndo');
    eq('выбор: «Вернуть» — все строки и ссылка', [(await dl()).length, await d.evaluate(() => C.refsOf(vis()[vis().length - 1].expr).length)], [nX, 1]);
    await d.click('#undoBtn');
  }
  // заметка, начинающаяся с цифр: #
  await d.keyboard.press('#');
  eq('ПК # открыл заметку', await d.isVisible('#nTxt'), true);
  await d.keyboard.type('358 — 2 листа'); await d.keyboard.press('Control+Enter');
  eq('ПК заметка с цифр', await d.$$eval('#lines .note', ns => ns.map(n => n.textContent)), ['358 — 2 листа']);
  await d.click('#undoBtn');
  // заметка прямо с клавиатуры: буквы → Enter (подписи с таким текстом нет)
  await d.keyboard.press('Escape');
  await d.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'П', bubbles: true})));
  await d.keyboard.insertText('озвонить снабженцу');
  eq('ПК буквы: предложено записать заметкой', (await d.textContent('#pkList')).includes('Записать заметкой'), true);
  await d.keyboard.press('Enter');
  eq('ПК буквы → Enter: заметка записана', await d.$$eval('#lines .note', ns => ns.map(n => n.textContent)), ['Позвонить снабженцу']);
  await d.click('#undoBtn');
  eq('ПК заметка отменяется', await d.$$eval('#lines .note', ns => ns.length), 0);
  // заметка: F2, Ctrl+Enter
  await d.keyboard.press('Escape');
  await d.keyboard.press('F2'); await d.keyboard.type('Заказ 358: 2 листа'); await d.keyboard.press('Control+Enter');
  eq('ПК заметка добавлена', await d.$$eval('#lines .note', ns => ns.map(n => n.textContent)), ['Заказ 358: 2 листа']);
  await d.click('#lines .note');
  eq('ПК заметка: одно нажатие не открывает правку', await d.isVisible('#nTxt'), false);
  await d.waitForTimeout(450);
  await d.locator('#lines .note').click({button: 'right'}); await d.click('#dlg .mi[data-r="ed"]');
  await d.fill('#nTxt', 'Заказ 358: 3 листа'); await d.click('#dlg .btns .pri');
  eq('ПК заметка изменена', await d.$$eval('#lines .note', ns => ns.map(n => n.textContent)), ['Заказ 358: 3 листа']);
  await d.click('#findBtn'); await d.fill('#q', '358');
  eq('ПК поиск находит заметку', await d.$$eval('#lines .ln.found .note', ns => ns.length), 1);
  await d.click('#qClose');
  await d.keyboard.press('ArrowUp');
  eq('ПК стрелки пропускают заметку', await d.$$eval('#lines .ln.act .note', ns => ns.length), 0);
  await d.keyboard.press('Escape');
  await d.locator('#lines .note').dblclick();
  eq('ПК двойной щелчок по заметке — копирует', await d.evaluate(() => navigator.clipboard.readText()), 'Заказ 358: 3 листа');
  await d.locator('#lines .note').click({button: 'right'}); await mi(d, 'del');
  eq('ПК удаление заметки — с подтверждением', await d.textContent('#dlg h2'), 'Удалить заметку?');
  await d.click('#dlg .btns .dng');
  eq('ПК заметка удалена в корзину', [await d.$$eval('#lines .note', ns => ns.length), await d.evaluate(() => trash().some(l => l.note))], [0, true]);
  // порядок главного меню
  await d.click('#menuBtn');
  eq('меню: сверху', await d.$$eval('#dlg > .box > .mi:not(.mo)', ns => ns.map(n => n.textContent)),
    ['Начать новый расчёт', 'Заметка', 'Шаблоны', 'Мини-окно поверх всех окон', 'Настройки', 'Справка', 'Корзина (1)', 'Создать резервную копию', 'Восстановить из резервной копии']);
  eq('меню: резервная копия выделена', await d.$eval('#dlg .mi[data-r="bk"]', n => n.classList.contains('hi')), true);
  eq('меню: под «Ещё» — синхронизировать и обновления', await d.$$eval('#moreBox .mi', ns => ns.slice(0, 2).map(n => n.textContent)), ['Синхронизировать', 'Проверить обновления']);
  await d.keyboard.press('Escape');

  // Delete по назначению
  const dr = async () => clean(await d.$eval('.ln.draft', n => n.textContent)).replace(/\s/g, '');
  await kb('12+34'); await d.keyboard.press('ArrowLeft'); await d.keyboard.press('ArrowLeft'); await d.keyboard.press('Delete');
  eq('ПК Delete: знак справа от курсора', (await dr()).split('=')[0], '12+4');
  await d.keyboard.press('End'); await d.keyboard.press('Delete');
  eq('ПК Delete в конце ввода — очистка', await dr(), '0');
  await d.locator('#lines .ln').nth(3).locator('.d').last().click(); await d.keyboard.press('Delete');
  eq('ПК Delete: выделенное число удалено', clean((await dl())[3]).split('=')[0].trim().endsWith('2 ^'), true);
  await d.keyboard.press('Control+z');
  await d.keyboard.press('Escape');
  const before = (await dl()).length;
  await d.keyboard.press('ArrowUp'); await d.keyboard.press('Shift+Delete'); await d.keyboard.press('Shift+Delete');
  eq('ПК Shift+Delete: строка удалена', (await dl()).length, before - 1);
  await d.keyboard.press('Control+z');
  eq('ПК Ctrl+Z вернул строку', (await dl()).length, before);

  // вставка текста
  await d.evaluate(() => { const e = new ClipboardEvent('paste', {clipboardData: new DataTransfer()}); e.clipboardData.setData('text', '1 234,5 * 2'); document.dispatchEvent(e); });
  eq('ПК разряды отступом', await d.$$eval('.ln.draft .d.g', ns => ns.length), 1);
  eq('ПК вставка', clean(await d.$eval('.ln.draft', n => n.textContent)), '1234,5 × 2= 2 469');
  await d.keyboard.press('Escape');
  // шаблон: из строки «120 × 1,2 + 45 × 1,5»
  await d.locator('#lines .ln').nth(0).click({button: 'right'});
  await mi(d, 'tpl');
  await d.fill('#tName', 'Две позиции');
  await d.fill('#dlg [data-f="0"]', 'кол-во 1'); await d.fill('#dlg [data-f="2"]', 'кол-во 2');
  await d.uncheck('#dlg [data-a="1"]'); await d.uncheck('#dlg [data-a="3"]');
  await d.click('#dlg .btns .pri');
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="tpls"]');
  await d.click('#dlg .tp .pk');
  eq('ПК шаблон: спрашивает 2 поля', await d.$$eval('#dlg [data-v]', ns => ns.length), 2);
  await d.fill('#dlg [data-v="0"]', '10'); await d.fill('#dlg [data-v="2"]', '4'); await d.keyboard.press('Enter');
  const TL = await dl();
  eq('ПК шаблон: строка', TL[TL.length - 1], 'Две позиции10 × 1,2 + 4 × 1,5 = 18');
  await d.reload();
  eq('ПК шаблон сохранился', await d.evaluate(() => JSON.parse(localStorage.getItem('calc:settings')).tpl.length), 1);
  await d.keyboard.press('Escape');
  await d.screenshot({path: OUT + '/pc-1.png'});
  const sciShown = () => d.$eval('#gSci', n => getComputedStyle(n).display !== 'none');
  eq('ПК: с функциями по умолчанию', await sciShown(), true);
  await d.click('#fxBtn');
  eq('ПК: обычный калькулятор', await sciShown(), false);
  eq('ПК: обычный — кнопки цифр видны', await d.$eval('#gNum [data-k="7"]', n => n.getBoundingClientRect().height > 40), true);
  await d.screenshot({path: OUT + '/pc-1b-basic.png'});
  await d.reload();
  eq('ПК: режим запомнился', await sciShown(), false);
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="st"]'); await d.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true)); await d.click('#dlg .seg[data-s="wideSci"] button[data-v="true"]'); await d.click('#dlg .btns .pri');
  eq('ПК: с функциями из настроек', await sciShown(), true);
  eq('телефон: кнопки f(x) нет', await p.$eval('#fxBtn', n => getComputedStyle(n).display), 'none');
  await d.click('#kbBtn');
  await d.screenshot({path: OUT + '/pc-2-nokeyboard.png'});
  await d.click('#kbBtn');
  // настройки сгруппированы и свёрнуты
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="st"]');
  eq('настройки: группы', await d.$$eval('#dlg details.sg > summary', ns => ns.map(n => n.textContent)), ['Числа и расчёт', 'Внешний вид', 'Клавиатура', 'Мини-окно (ПК)', 'История и синхронизация']);
  eq('настройки: группы свёрнуты', await d.$$eval('#dlg details.sg[open]', ns => ns.length), 0);
  await d.click('#dlg details.sg:nth-of-type(2) > summary');
  eq('настройки: группа раскрывается', await d.isVisible('#dlg .seg[data-s="pcZoom"]'), true);
  eq('ПК: есть 70%', await d.$$eval('#dlg .seg[data-s="pcZoom"] button', ns => ns.map(n => n.textContent)), ['70%', '80%', '90%', '100%', '115%', '130%', '150%']);
  await d.click('#dlg .btns .pri');
  // ширина клавиатуры на ПК и размер знаков на кнопках
  const padW = () => d.evaluate(() => Math.round(document.querySelector('#pad').getBoundingClientRect().width / innerWidth * 100));
  const keyFs = () => d.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#gNum [data-k="7"]')).fontSize));
  const w0 = await padW(), f0 = await keyFs();
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="st"]'); await d.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true));
  eq('ПК: настройки клавиатуры', await d.$$eval('#dlg .opt .lb', ns => ns.map(n => n.firstChild.textContent).filter(x => /клавиатур/i.test(x))),
    ['Ширина клавиатуры', 'Высота клавиатуры в мини-окне', 'Размер знаков на клавиатуре', 'Клавиатура на широком экране']);
  await d.click('#dlg .seg[data-s="kbWd"] button[data-v="40"]');
  eq('ПК: ширина клавиатуры 40 %', await padW(), 40);
  await d.click('#dlg [data-kdst="+"]');
  eq('ПК: ширина 41 % (точно)', [await d.textContent('#kdV'), await padW()], ['41%', 41]);
  await d.click('#dlg .seg[data-s="kbWd"] button[data-v="0"]');
  eq('ПК: ширина «авто» — как раньше', [await d.textContent('#kdV'), await padW()], ['авто', w0]);
  await d.click('#dlg .seg[data-s="keyZoom"] button[data-v="130"]');
  eq('ПК: знаки на кнопках 130 %', Math.round(await keyFs() / f0 * 100), 130);
  await d.click('#dlg .seg[data-s="keyZoom"] button[data-v="100"]');
  await d.click('#dlg .btns .pri');
  // размер цифр на ПК (в процентах)
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="st"]'); await d.evaluate(() => DOC.querySelectorAll('#dlg details').forEach(x => x.open = true));
  eq('ПК: настройка «Размер цифр на ПК»', [await d.isVisible('#dlg .seg[data-s="pcZoom"]'), await d.isVisible('#dlg .seg[data-s="size"]')], [true, false]);
  await d.click('#dlg .seg[data-s="pcZoom"] button[data-v="130"]');
  await d.click('#dlg [data-zst="+"]');
  eq('ПК: размер 135%', [await d.textContent('#zV'), await d.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim())], ['135%', '1.35']);
  await d.click('#dlg [data-zst="-"]'); await d.click('#dlg [data-zst="-"]'); await d.click('#dlg [data-zst="-"]'); await d.click('#dlg [data-zst="-"]'); await d.click('#dlg [data-zst="-"]'); await d.click('#dlg [data-zst="-"]'); await d.click('#dlg [data-zst="-"]');
  eq('ПК: снова 100%', await d.textContent('#zV'), '100%');
  await d.click('#dlg .btns .pri');

  // справка: отдельный файл help.part
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="help"]');
  await d.waitForSelector('#helpView .hb details');
  eq('справка: открыта', await d.isVisible('#helpView'), true);
  const secs = await d.$$eval('#helpView .hb details', ns => ns.map(n => n.id));
  eq('справка: разделов', secs.length >= 15, true);
  eq('справка: оглавление ведёт на существующие разделы', await d.$$eval('#helpView .toc a', as => as.every(a => document.querySelector(a.getAttribute('href')))), true);
  eq('справка: разделы свёрнуты (кроме «Что нового»)', await d.$$eval('#helpView .hb details[open]', ns => ns.map(n => n.id)), ['h-new']);
  await d.click('#helpView .hb details#h-round summary');
  eq('справка: раздел раскрывается нажатием', await d.$eval('#h-round', n => n.open), true);
  await d.click('#helpOpenAll');
  eq('справка: развернуть всё', await d.$$eval('#helpView .hb details:not([open])', ns => ns.length), 0);
  await d.click('#helpCloseAll');
  eq('справка: свернуть всё', await d.$$eval('#helpView .hb details[open]', ns => ns.length), 0);
  await d.click('#helpView .toc a[href="#h-mini"]');
  eq('справка: оглавление раскрывает раздел', await d.$eval('#h-mini', n => n.open), true);
  eq('справка: переход по оглавлению без смены адреса', [await d.isVisible('#helpView'), await d.evaluate(() => location.hash)], [true, '']);
  await d.screenshot({path: OUT + '/pc-3-help.png'});
  await d.keyboard.press('Escape');
  eq('справка: Esc закрыл', await d.isVisible('#helpView'), false);
  await d.keyboard.press('F1');
  eq('справка: F1 открыл', await d.isVisible('#helpView'), true);
  await d.click('#helpClose');
  eq('справка: ✕ закрыл', await d.isVisible('#helpView'), false);
  // справка описывает все пункты главного меню и все настройки
  const src = await d.evaluate(async () => [await (await fetch('index.html')).text(), await (await fetch('help.part')).text()]);
  const helpText = src[1].replace(/<[^>]+>/g, ' ').toLowerCase();
  const menuBlock = src[0].slice(src[0].indexOf("choose('Меню'"), src[0].indexOf("`Версия ${APP_VERSION}"));
  const menuLabels = [...menuBlock.matchAll(/l:'([^']+)'/g)].map(m => m[1]).filter(l => l !== 'Справка');
  const setLabels = [...src[0].matchAll(/<div class="opt"><div class="lb">([^<$]+)/g)].map(m => m[1].trim());
  eq('справка: пункты меню описаны', menuLabels.filter(l => !helpText.includes(l.toLowerCase())), []);
  eq('справка: настройки описаны', setLabels.filter(l => !helpText.includes(l.toLowerCase())), []);
  eq('справка: найдены пункты меню и настройки', [menuLabels.length >= 8, setLabels.length >= 14], [true, true]);
  eq('справка: пункты меню с переключением', ['начать новый расчёт', 'мини-окно поверх всех окон'].filter(l => !helpText.includes(l)), []);

  // мини-окно поверх всех окон: в тесте окно Chrome «картинка в картинке» заменено обычным всплывающим окном
  const pcm = await browser.newContext({viewport: {width: 1280, height: 720}});
  await pcm.addInitScript(() => { Object.defineProperty(window, 'documentPictureInPicture', {configurable: true, value: {requestWindow: async o => window.open('', 'mini', `width=${o.width},height=${o.height}`)}}); });
  const m = await pcm.newPage();
  m.on('pageerror', e => errors.push('mini: ' + e.message));
  await m.goto(URL);
  for (const ch of '6*7') await m.keyboard.press(ch); await m.keyboard.press('Enter');
  eq('мини: кнопка есть', await m.$eval('#miniBtn', n => n.classList.contains('hidden')), false);
  const [mw] = await Promise.all([m.waitForEvent('popup'), m.click('#miniBtn')]);
  await mw.waitForSelector('#lines .ln');
  await mw.setViewportSize({width: 360, height: 600}); // настоящее мини-окно — 360×600
  eq('мини: история в мини-окне', clean(await mw.$eval('#lines .ln', n => n.textContent)), '6 × 7 = 42');
  eq('мини: в основном окне заглушка', clean(await m.textContent('#miniNote')), 'Калькулятор открыт в мини-окне поверх всех оконВернуть сюда');
  eq('мини: узкая раскладка (клавиатура снизу)', await mw.$eval('main', n => getComputedStyle(n).flexDirection), 'column');
  for (const ch of '+8') await mw.keyboard.press(ch);
  await mw.click('#pad [data-k="="]:visible');
  eq('мини: расчёт в мини-окне', clean((await mw.$$eval('#lines .ln:not(.draft)', ns => ns.map(n => n.textContent)))[1]), '42 + 8 = 50');
  await mw.locator('#lines .ln').nth(0).click({button: 'right'});
  eq('мини: меню строки открывается', await mw.$$eval('#dlg .mi', ns => ns.length) > 3, true);
  await mw.keyboard.press('Escape');
  eq('мини: цвет полоски окна по теме', await mw.$eval('meta[name=theme-color]', n => n.content), '#161a23');
  // выбор режимов мини-окна в настройках: без «компактного» и без полоски
  await m.evaluate(() => { S.miniOn = ['full', 'nokb', 'line']; applyMiniOn(); });
  eq('мини: полоска выключена — кнопки нет', await mw.isVisible('#stripBtn'), false);
  await mw.click('#sizeBtn');
  eq('мини: «компактное» пропущено', await mw.evaluate(() => document.body.classList.contains('m-nokb')), true);
  await mw.click('#mFab').catch(() => {}); await mw.keyboard.press('Control+ArrowUp');
  eq('мини: Ctrl+↑ — обратно к обычному', await mw.evaluate(() => document.body.classList.contains('m-full')), true);
  await m.evaluate(() => { S.miniOn = ['full', 'compact', 'nokb', 'line', 'strip']; applyMiniOn(); });
  eq('мини: полоска включена — кнопка есть', await mw.isVisible('#stripBtn'), true);
  // «одна строка»: меню открывается в компактном размере, нажатие на строку выбирает строку для Delete
  await mw.click('#sizeBtn'); await mw.click('#sizeBtn'); await mw.click('#sizeBtn');
  eq('мини: одна строка', await mw.evaluate(() => document.body.classList.contains('m-line')), true);
  await mw.keyboard.press('ArrowUp');
  await mw.locator('#lines .ln.act').click({button: 'right', position: {x: 200, y: 10}, force: true});
  eq('мини: меню в «одной строке» — компактный размер', [await mw.evaluate(() => document.body.classList.contains('m-compact')), await mw.isVisible('#dlg .mi')], [true, true]);
  await mw.keyboard.press('Escape');
  await mw.waitForTimeout(50);
  eq('мини: после меню снова «одна строка»', await mw.evaluate(() => document.body.classList.contains('m-line') && !document.body.classList.contains('m-compact')), true);
  const nLine = await m.evaluate(() => vis().length);
  await mw.keyboard.press('Escape'); await mw.keyboard.press('ArrowUp');
  await mw.locator('#lines .ln.act .d').first().click({force: true});
  eq('мини: нажатие на строку не выделяет число', await m.evaluate(() => [ed.hl, !!ed.sel]), [false, false]);
  await mw.keyboard.press('Delete'); await mw.keyboard.press('Delete');
  eq('мини: Delete после нажатия мышью удаляет строку', await m.evaluate(() => vis().length), nLine - 1);
  await mw.keyboard.press('Control+z');
  await mw.click('#mFab');
  eq('мини: снова обычный режим', await mw.evaluate(() => document.body.classList.contains('m-full')), true);
  // свернуть в полоску и развернуть
  await mw.click('#stripBtn');
  eq('мини: полоска', [await mw.evaluate(() => document.body.classList.contains('m-strip')), await mw.isVisible('#strip'), await mw.isVisible('#pad')], [true, true, false]);
  eq('мини: в полоске последний результат', (await mw.textContent('#stripRes')).trim(), '50');
  await mw.click('#strip');
  eq('мини: развернулось в прежний режим', await mw.evaluate(() => document.body.classList.contains('m-full')), true);
  eq('мини: тема перенесена', await mw.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--eq').trim()), '#31a84a');
  await mw.setViewportSize({width: 360, height: 600});
  await mw.screenshot({path: OUT + '/pc-4-mini.png'});
  // режимы размера мини-окна
  const visLines = () => mw.$$eval('#lines .ln', ns => ns.filter(n => n.offsetParent !== null).map(n => n.textContent.replace(/[\u202F\u00A0]/g, ' ').replace(/\s+/g, ' ').trim()));
  eq('мини: обычный режим', await mw.evaluate(() => document.body.classList.contains('m-full')), true);
  await mw.click('#sizeBtn');
  eq('мини: компактный режим', await mw.evaluate(() => document.body.classList.contains('m-compact')), true);
  await mw.click('#sizeBtn');
  eq('мини: без клавиатуры', await mw.$eval('#pad', n => getComputedStyle(n).display), 'none');
  await mw.click('#sizeBtn');
  eq('мини: одна строка', await mw.evaluate(() => document.body.classList.contains('m-line')), true);
  await mw.setViewportSize({width: 380, height: 60});
  eq('мини: одна строка — по умолчанию пустая', await visLines(), ['0']);
  for (const ch of '2*3') await mw.keyboard.press(ch);
  eq('мини: одна строка — ввод с результатом', await visLines(), ['2 × 3= 6']);
  await mw.screenshot({path: OUT + '/pc-5-mini-line.png'});
  await mw.keyboard.press('Enter');
  eq('мини: одна строка — после «=» снова пустая', await visLines(), ['0']);
  await mw.keyboard.press('ArrowUp');
  eq('мини: ↑ — последний расчёт', await visLines(), ['2 × 3 = 6']);
  await mw.keyboard.press('ArrowUp');
  eq('мини: ↑ — предыдущий', await visLines(), ['42 + 8 = 50']);
  await mw.keyboard.press('ArrowDown');
  eq('мини: ↓ — обратно', await visLines(), ['2 × 3 = 6']);
  await mw.keyboard.press('Escape');
  eq('мини: Esc — пустая строка', await visLines(), ['0']);
  await mw.click('#mFab');
  eq('мини: снова обычный', await mw.evaluate(() => document.body.classList.contains('m-full')), true);
  await mw.keyboard.press('Control+ArrowDown');
  eq('мини: Ctrl+↓ — меньше', await mw.evaluate(() => document.body.classList.contains('m-compact')), true);
  await mw.keyboard.press('Control+ArrowUp');
  eq('мини: Ctrl+↑ — больше', await mw.evaluate(() => document.body.classList.contains('m-full')), true);
  await mw.setViewportSize({width: 360, height: 600});
  await mw.keyboard.press('Control+m').catch(() => {}); // Ctrl+M в мини-окне — вернуть (окно закрывается во время нажатия)
  await m.waitForSelector('#lines .ln');
  eq('мини: Ctrl+M вернул калькулятор', await m.$$eval('#miniNote', ns => ns.length), 0);
  const [mw2] = await Promise.all([m.waitForEvent('popup'), m.keyboard.press('Control+m')]);
  await mw2.waitForSelector('#lines .ln');
  eq('мини: Ctrl+M открыл мини-окно', await m.$$eval('#miniNote', ns => ns.length), 1);
  await mw2.close();
  await m.waitForSelector('#lines .ln');
  eq('мини: закрыто — всё вернулось', (await m.$$eval('#lines .ln:not(.draft)', ns => ns.map(n => n.textContent))).map(clean), ['6 × 7 = 42', '42 + 8 = 50', '2 × 3 = 6']);
  eq('мини: заглушка убрана', await m.$$eval('#miniNote', ns => ns.length), 0);
  await m.keyboard.press('9');
  eq('мини: клавиатура снова в основном окне', clean(await m.$eval('.ln.draft', n => n.textContent)), '9');
  await pcm.close();

  // мини-окно из калькулятора, открытого внутри лаунчера (врезка на том же сайте): окно просит лаунчер
  if (process.argv[4]) {
    const pcf = await browser.newContext({viewport: {width: 1280, height: 720}});
    await pcf.addInitScript(() => { Object.defineProperty(window, 'documentPictureInPicture', {configurable: true, value: {requestWindow: async o => { window.__pipFrom = window === window.top ? 'лаунчер' : 'врезка'; return window.open('', 'mini', `width=${o.width},height=${o.height}`); }}}); });
    const host = await pcf.newPage();
    host.on('pageerror', e => errors.push('host: ' + e.message));
    await host.goto(process.argv[4]);
    const fr = host.frameLocator('#app');
    await fr.locator('#lines').waitFor({state: 'attached'});
    await host.frames()[1].evaluate(() => { for (const k of ['5', '×', '5']) key(k); key('='); });
    const [fw] = await Promise.all([host.waitForEvent('popup'), fr.locator('#miniBtn').click()]);
    await fw.waitForSelector('#lines .ln');
    eq('врезка: мини-окно запрошено у лаунчера', await host.evaluate(() => window.__pipFrom), 'лаунчер');
    eq('врезка: история в мини-окне', clean(await fw.$eval('#lines .ln:not(.draft)', n => n.textContent)), '5 × 5 = 25');
    await fw.close();
    await fr.locator('#lines .ln:not(.draft)').first().waitFor();
    eq('врезка: после закрытия всё вернулось', clean(await fr.locator('#lines .ln:not(.draft)').first().textContent()), '5 × 5 = 25');
    await pcf.close();
  }

  // офлайн-кэш: сервис-воркер установлен, кэш с префиксом calc-
  await d.reload();
  await d.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready, null, {timeout: 5000});
  await d.evaluate(() => navigator.serviceWorker.ready);
  await d.waitForTimeout(800);
  eq('кэш', await d.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('calc-'))), ['calc-5.2']);
  eq('справка в офлайн-кэше', await d.evaluate(async () => !!(await (await caches.open((await caches.keys()).find(k => k.startsWith('calc-')))).match('help.part'))), true);

  eq('ошибок JS нет', errors, []);
  await browser.close();
  console.log(`\nИнтерфейс: пройдено ${ok}, ошибок ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
