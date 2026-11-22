// Проверка интерфейса в Chrome: node tests/ui.test.js <url> <папка для снимков>
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
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="hlIn"] button[data-v="false"]'); await p.click('#dlg .btns .pri');
  eq('подсветка выключена', await draftSel(), []);
  eq('курсор вместо подсветки', await p.$$eval('.ln.draft .caret', ns => ns.length), 1);
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="hlIn"] button[data-v="true"]'); await p.click('#dlg .btns .pri');
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
  await p.click('#dlg .mi.dng');
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
  // если число исправили, «=» только заканчивает правку
  await p.locator('#lines .ln').nth(3).locator('.d').last().click(); await tap('9'); await tap('=');
  eq('после правки не переносится', clean(await draftText()), '0');
  await p.click('#undoBtn');
  // долгое нажатие на число: копировать и вставить в строку ввода
  await phone.grantPermissions(['clipboard-read', 'clipboard-write']);
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
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="kb"] button[data-v="40"]'); await p.click('#dlg .btns .pri');
  eq('высота клавиатуры ниже 40%', Math.round(await p.$eval('#pad', n => n.getBoundingClientRect().height) / 780 * 100), 40);
  await p.screenshot({path: OUT + '/phone-11-kb40.png'});
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]');
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
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="kb"] button[data-v="47"]'); await p.click('#dlg .btns .pri');

  // свернуть клавиатуру
  await tap('tog');
  eq('клавиатура свёрнута', await p.$eval('#pad', n => n.classList.contains('min')), true);
  await p.screenshot({path: OUT + '/phone-5-collapsed.png'});
  await tap('tog');

  // темы
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="th"]');
  await p.screenshot({path: OUT + '/phone-6-themes.png', fullPage: false});
  await p.click('#dlg .th[data-t="classic"]');
  await p.click('#dlg .btns .pri');
  await p.screenshot({path: OUT + '/phone-7-classic.png'});
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="th"]'); await p.click('#dlg .th[data-t="sunset"]'); await p.click('#dlg .btns .pri');
  await p.screenshot({path: OUT + '/phone-8-sunset.png'});

  // настройки: точка как разделитель
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]');
  await p.click('#dlg .seg[data-s="sep"] button[data-v="."]');
  await p.click('#dlg .btns .pri');
  L = (await lineTexts()).map(clean);
  eq('разделитель точка', L[0], '150000 × 0.155 = 23 250');
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="sep"] button[data-v=","]'); await p.click('#dlg .btns .pri');

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
  await mi(p, 'sel');
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
  eq('меню: сверху', await p.$$eval('#dlg > .box > .mi:not(.mo)', ns => ns.map(n => n.textContent)), ['Вставить результат в строку ввода', 'Копировать результат', 'Править строку', 'Удалить строку']);
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
  eq('выбор по подписи: найдено', await p.$$eval('#dlg .pk', ns => ns.length), 1);
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
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="nums"] button[data-v="true"]'); await p.click('#dlg .btns .pri');
  eq('номера строк', await p.$$eval('#lines .no', ns => ns.slice(0, 3).map(n => n.textContent)), ['1', '2', '3']);
  await p.screenshot({path: OUT + '/phone-16-nums.png'});
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="nums"] button[data-v="false"]'); await p.click('#dlg .btns .pri');
  // подписи можно выключить
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="labels"] button[data-v="false"]'); await p.click('#dlg .btns .pri');
  eq('подписи выключены', await p.$$eval('#lines .lbl', ns => ns.length), 0);
  await p.locator('#lines .ln').nth(0).click({button: 'right'});
  eq('пункта «Подпись» нет', await p.$$eval('#dlg .mi[data-r="lbl"]', ns => ns.length), 0);
  await p.keyboard.press('Escape');
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="st"]'); await p.click('#dlg .seg[data-s="labels"] button[data-v="true"]'); await p.click('#dlg .btns .pri');
  eq('подписи снова видны', await p.$$eval('#lines .lbl', ns => ns.map(n => n.textContent)), ['лист 2 мм']);

  // история сохраняется после перезапуска
  await p.reload();
  L = (await lineTexts()).map(clean);
  eq('после перезапуска строк', L.length, 9);
  eq('после перезапуска тема', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()), '#ffe08a');
  eq('ключи хранилища с префиксом', await p.evaluate(() => Object.keys(localStorage).every(k => k.startsWith('calc:'))), true);

  // горизонтальная ориентация телефона
  await p.setViewportSize({width: 780, height: 393});
  await p.click('#menuBtn'); await p.click('#dlg .mi[data-r="th"]'); await p.click('#dlg .th[data-t="dark"]'); await p.click('#dlg .btns .pri');
  await p.screenshot({path: OUT + '/phone-9-landscape.png'});
  await p.setViewportSize({width: 393, height: 780});
  await p.screenshot({path: OUT + '/phone-10-dark.png'});

  /* ---------- ПК ---------- */
  const pc = await browser.newContext({viewport: {width: 1280, height: 720}});
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
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="st"]'); await d.click('#dlg .seg[data-s="wideSci"] button[data-v="true"]'); await d.click('#dlg .btns .pri');
  eq('ПК: с функциями из настроек', await sciShown(), true);
  eq('телефон: кнопки f(x) нет', await p.$eval('#fxBtn', n => getComputedStyle(n).display), 'none');
  await d.click('#kbBtn');
  await d.screenshot({path: OUT + '/pc-2-nokeyboard.png'});
  await d.click('#kbBtn');
  await d.click('#menuBtn'); await d.click('#dlg .mi[data-r="help"]');
  await d.screenshot({path: OUT + '/pc-3-help.png'});
  await d.keyboard.press('Escape');

  // мини-окно поверх всех окон: в тесте окно Chrome «картинка в картинке» заменено обычным всплывающим окном
  const pcm = await browser.newContext({viewport: {width: 1280, height: 720}});
  await pcm.addInitScript(() => { window.documentPictureInPicture = {requestWindow: async o => window.open('', 'mini', `width=${o.width},height=${o.height}`)}; });
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
  eq('мини: тема перенесена', await mw.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--eq').trim()), '#31a84a');
  await mw.setViewportSize({width: 360, height: 600});
  await mw.screenshot({path: OUT + '/pc-4-mini.png'});
  await mw.close();
  await m.waitForSelector('#lines .ln');
  eq('мини: закрыто — всё вернулось', (await m.$$eval('#lines .ln:not(.draft)', ns => ns.map(n => n.textContent))).map(clean), ['6 × 7 = 42', '42 + 8 = 50']);
  eq('мини: заглушка убрана', await m.$$eval('#miniNote', ns => ns.length), 0);
  await m.keyboard.press('9');
  eq('мини: клавиатура снова в основном окне', clean(await m.$eval('.ln.draft', n => n.textContent)), '9');
  await pcm.close();

  // офлайн-кэш: сервис-воркер установлен, кэш с префиксом calc-
  await d.reload();
  await d.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready, null, {timeout: 5000});
  await d.evaluate(() => navigator.serviceWorker.ready);
  await d.waitForTimeout(800);
  eq('кэш', await d.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('calc-'))), ['calc-2.3']);

  eq('ошибок JS нет', errors, []);
  await browser.close();
  console.log(`\nИнтерфейс: пройдено ${ok}, ошибок ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
