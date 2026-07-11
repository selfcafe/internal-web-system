// 店舗マスタ（基本店舗一覧）。index.html・invoice.html の両方から <script src="stores.js"></script> で読み込む単一の共有ファイル。
// 店舗を追加・削除・改名する場合はここを編集すれば両画面に反映される（custom_stores/deleted_storesによる動的な追加・削除は別途GAS経由で反映される）。
const STORES = {
  /* 東海 */
  sasashima:'ささしまライブ', chikusa:'千種', gokaiso:'御器所', tsuruma:'鶴舞',
  kamisawa:'神沢', nakamura_nisseki:'中村日赤', midori_kofubutsu:'緑鴻仏目',
  sakurayama:'桜山', akatsuka:'赤塚', shin_moriyama:'新守山', tokoname:'常滑',
  hamamatsu:'浜松新橋', sakae:'栄', rokubanchou:'六番町', nonami:'野並',
  seto_iwayadou:'瀬戸岩屋堂', nagakute:'長久手', meieki_nishi:'名駅西口',
  nadia_sakae:'ナディアパーク栄', shinmizuhashi:'新瑞橋', eisei:'栄生',
  hotei:'布袋駅', kamejima:'亀島', nakamura_torii:'中村日赤鳥居通',
  taikodori:'太閤通駅', kouta:'幸田', hibino:'日比野', hoshigaoka:'星が丘',
  ikeshita:'池下', toyota:'T-FACE豊田', hara:'原', fujigaoka:'藤が丘',
  gifu_kitagata:'イオンタウン岐阜北方', narumi:'鳴海山下',
  /* 関西 */
  tenma:'天満', higashiosaka:'東大阪小若江', aikawa:'相川駅前',
  minami_morimachi:'南森町', abeno:'あべの南', tanimachi9:'谷町九丁目',
  moriguchi:'守口駅前', taishibashi:'太子橋', kyobashi_kita:'京橋北',
  shinsaibashi:'心斎橋東急ビル', kishi:'喜志', umeda:'梅田センタービル',
  kami_shinjyo:'上新庄', osaka_hirano:'大阪平野西', hikone:'イオンタウン彦根',
  aeon_higashiosaka:'イオンタウン東大阪', gamo4:'蒲生四丁目',
  /* 関東 */
  inzai:'印西牧の原', otsuka:'大塚駅南口', sugamo:'巣鴨駅南口',
  umejima:'梅島（うめじま）', shibuya:'渋谷神南',
  shinjuku_fc:'FC 新宿西口Shinjuku Future Gallery', kamisato:'カインズ上里本庄',
};
