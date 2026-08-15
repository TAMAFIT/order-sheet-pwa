function rewriteHandoffCopy() {
  const shareButton = document.querySelector('#chatgptShareBtn');
  const card = shareButton?.closest('.card');
  if (!card) return;

  const intro = card.querySelector('.card-sub');
  if (intro) {
    intro.textContent = '「GPTへ送る」で専用の手書き注文解析GPTを直接開きます。対応端末ではSCAN_ID入り画像をクリップボードへ入れるので、GPT側で貼り付けて送信してください。';
  }

  const steps = [...card.querySelectorAll('.guided-flow .flow-step')];
  if (steps[0]) {
    const title = steps[0].querySelector('h3');
    const paragraph = steps[0].querySelector('p');
    if (title) title.textContent = '専用GPTを開く';
    if (paragraph) paragraph.textContent = 'ボタンを押すと共有用画像を準備し、可能なら画像をクリップボードへコピーしてから「手書き注文解析GPT」を開きます。';
    if (shareButton) shareButton.textContent = '手書き注文解析GPTを開く';
  }

  if (steps[1]) {
    const title = steps[1].querySelector('h3');
    const paragraphs = steps[1].querySelectorAll('p');
    if (title) title.textContent = '画像を貼り付けて送信';
    if (paragraphs[0]) paragraphs[0].textContent = 'GPTが開いたら入力欄で「貼り付け」を使って画像を入れて送信してください。画像クリップボード非対応の端末では、共有用画像を先に保存してからGPTを開くフォールバックに切り替わります。';
    if (paragraphs[1]) paragraphs[1].textContent = '解析後は submitScanResult Action が結果をCloudflareへ保存します。Action失敗時だけJSONコピーの予備ルートを使えます。';
  }

  if (steps[2]) {
    const title = steps[2].querySelector('h3');
    const paragraph = steps[2].querySelector('p');
    if (title) title.textContent = 'PWAへ戻る → 自動取得';
    if (paragraph) paragraph.textContent = '解析が終わったらPWAへ戻るだけです。同じSCAN_IDの結果を自動取得して、紙の順の全件確認画面へ進みます。';
  }
}

if (typeof document !== 'undefined') queueMicrotask(rewriteHandoffCopy);
