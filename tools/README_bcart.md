# Bカート自動カート入れ（iPhone の Safari）

トーヨーベンディングの発注サイト「ミル挽き珈琲CAFE」（Bカート、https://mirubiki-coffee.i16.bcart.jp/ ）で、
ポータル・Bot の「Bカートに入れる」リンクを開くと、品と数をカートに入れるスクリプト（`selfcafe-bcart.user.js`）。2026-10-16 作成。

- Bカートには注文する側の窓口（API）が無い。このスクリプトは Safari に残っているログインのまま、商品ページの「カートに入れる」ボタンと同じ送信（`cart/add`）をする。パスワードは扱わない
- 注文の確定（配送先・支払いを選んで「ご注文を確定する」）は人が押す
- リンクの形: `https://mirubiki-coffee.i16.bcart.jp/list.php#sc-cart=8x6,12x2&store=藤が丘`
  - `8x6` = 商品番号 8（product.php?id=8、ブレンドA）を 6（サイトの単位。ブレンドAは kg）
  - 商品番号は selfcafe-automation の config/jcc_master.json の bcart_id
- カートに別の品が入っているとき・同じリンクを二度開いたときは、入れる前に確認が出る

## iPhone への入れ方
1. App Store で「Userscripts」（無料）を入れる
2. Userscripts アプリを開き、スクリプトを置くフォルダを選ぶ（ファイル App の「このiPhone内」に新しいフォルダを作って選ぶ）
3. 設定アプリ → アプリ → Safari → 機能拡張 → Userscripts をオンにし、mirubiki-coffee.i16.bcart.jp での動作を「許可」にする
4. Safari で https://selfcafe.github.io/internal-web-system/tools/selfcafe-bcart.user.js を開く → アドレスバーの機能拡張ボタン → Userscripts → インストール
5. Safari で Bカートにログインする（「ログイン状態を保持する」にチェック。関東・関西・東海でアカウントが別）
