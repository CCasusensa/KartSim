import { gameLocale } from "../locale";

/** Authored city menu names, objectives and summaries; never applied to player names or chat. */
export const cityContentNames: Readonly<Record<string, readonly [string, string]>> = {
  "一锅好汤": [
    "A Pot of Good Soup",
    "맛있는 수프 한 냄비"
  ],
  "上班要迟到了": [
    "Late for Work",
    "출근에 늦겠어요"
  ],
  "义卖募集": [
    "Charity Sale Collection",
    "자선 바자회 물품 모으기"
  ],
  "会说话的鹦鹉": [
    "The Talking Parrot",
    "말하는 앵무새"
  ],
  "修好的怀表": [
    "The Repaired Pocket Watch",
    "수리한 회중시계"
  ],
  "修篱笆": [
    "Fixing the Fence",
    "울타리 수리"
  ],
  "借工具": [
    "Borrowing Tools",
    "공구 빌리기"
  ],
  "冠军奖杯": [
    "The Champion's Trophy",
    "챔피언의 트로피"
  ],
  "冰镇椰子汁": [
    "Chilled Coconut Juice",
    "시원한 코코넛 주스"
  ],
  "冰镇饮料": [
    "Chilled Drinks",
    "시원한 음료"
  ],
  "冰鲜送达": [
    "Keep It Chilled",
    "신선하게 배달하기"
  ],
  "冲浪板": [
    "The Surfboard",
    "서핑보드"
  ],
  "冷藏疫苗": [
    "Refrigerated Vaccines",
    "냉장 백신"
  ],
  "刚做的发型": [
    "A Fresh Hairstyle",
    "방금 한 머리"
  ],
  "加急件": [
    "Urgent Delivery",
    "긴급 배송"
  ],
  "加急包裹": [
    "Urgent Parcel",
    "긴급 소포"
  ],
  "午餐外卖": [
    "Lunch Delivery",
    "점심 배달"
  ],
  "去办手续": [
    "Paperwork to File",
    "서류 처리하러 가기"
  ],
  "去取车": [
    "Picking Up the Car",
    "차를 찾으러 가기"
  ],
  "去吃三明治": [
    "Time for a Sandwich",
    "샌드위치 먹으러 가기"
  ],
  "去复诊": [
    "A Follow-up Appointment",
    "재진 받으러 가기"
  ],
  "去找皮蛋": [
    "Looking for Dao",
    "다오를 만나러"
  ],
  "去进货": [
    "Restocking Supplies",
    "물건 들여오기"
  ],
  "去逛街": [
    "A Shopping Trip",
    "쇼핑하러 가기"
  ],
  "取药": [
    "Picking Up Medicine",
    "약 찾으러 가기"
  ],
  "合同急件": [
    "An Urgent Contract",
    "긴급 계약서"
  ],
  "城市取景": [
    "City Photo Shoot",
    "도시 촬영"
  ],
  "城市观光": [
    "City Sightseeing",
    "도시 관광"
  ],
  "备用钥匙": [
    "The Spare Key",
    "여분의 열쇠"
  ],
  "外婆的雨伞": [
    "Grandma's Umbrella",
    "할머니의 우산"
  ],
  "多肉盆栽": [
    "A Potted Succulent",
    "다육식물 화분"
  ],
  "大风筝": [
    "The Big Kite",
    "커다란 연"
  ],
  "失物归还": [
    "Returning Lost Property",
    "분실물 돌려주기"
  ],
  "失物招领": [
    "Lost and Found",
    "분실물 찾아가세요"
  ],
  "失落的藏宝图": [
    "The Lost Treasure Map",
    "잃어버린 보물지도"
  ],
  "守法驾驶示范": [
    "A Safe Driving Demonstration",
    "교통법규 준수 시범"
  ],
  "寄往远方": [
    "Mail to Far Away",
    "먼 곳으로 보내는 우편"
  ],
  "寄给家乡的风筝": [
    "A Kite for Home",
    "고향으로 보내는 연"
  ],
  "导游上班": [
    "The Guide's Commute",
    "가이드의 출근"
  ],
  "小心洒出来": [
    "Careful, Don't Spill It",
    "쏟지 않게 조심"
  ],
  "小狗去哪儿了": [
    "Where Did the Puppy Go?",
    "강아지는 어디에?"
  ],
  "工作证不见了": [
    "The Missing Work ID",
    "사라진 사원증"
  ],
  "幸运扳手": [
    "The Lucky Wrench",
    "행운의 렌치"
  ],
  "急救包": [
    "The First Aid Kit",
    "구급상자"
  ],
  "急用药品": [
    "Urgently Needed Medicine",
    "급히 필요한 약"
  ],
  "感谢信": [
    "A Thank-you Letter",
    "감사 편지"
  ],
  "手机快没电了": [
    "Phone Battery Running Low",
    "휴대폰 배터리가 없어요"
  ],
  "投票箱": [
    "The Ballot Box",
    "투표함"
  ],
  "抱着画坐车": [
    "A Ride with a Painting",
    "그림을 안고 타기"
  ],
  "抱着蛋糕坐车": [
    "A Ride with a Cake",
    "케이크를 안고 타기"
  ],
  "捡传单": [
    "Picking Up Flyers",
    "전단지 줍기"
  ],
  "捡球": [
    "Collecting Balls",
    "공 줍기"
  ],
  "换胎急件": [
    "Urgent Tire Replacement",
    "긴급 타이어 교체"
  ],
  "掉下车的包裹": [
    "A Parcel Fell Off",
    "차에서 떨어진 소포"
  ],
  "探病鲜花": [
    "Flowers for a Patient",
    "병문안 꽃"
  ],
  "接机花束": [
    "An Airport Welcome Bouquet",
    "공항 마중 꽃다발"
  ],
  "撤海报": [
    "Taking Down Posters",
    "포스터 떼기"
  ],
  "收信": [
    "Collecting Mail",
    "우편 수거"
  ],
  "收回寄卖品": [
    "Collecting Consigned Goods",
    "위탁 물품 회수"
  ],
  "收回工具": [
    "Collecting the Tools",
    "공구 회수"
  ],
  "收灯笼": [
    "Collecting Lanterns",
    "등불 수거"
  ],
  "收集签名": [
    "Collecting Signatures",
    "서명 모으기"
  ],
  "收鸡蛋": [
    "Collecting Eggs",
    "달걀 수거"
  ],
  "散落的工具箱": [
    "The Scattered Toolboxes",
    "흩어진 공구함"
  ],
  "散落的零件": [
    "The Scattered Parts",
    "흩어진 부품"
  ],
  "新烘咖啡豆": [
    "Freshly Roasted Coffee Beans",
    "갓 볶은 커피 원두"
  ],
  "新的指挥棒": [
    "A New Traffic Baton",
    "새 교통 지휘봉"
  ],
  "新鲜鸡蛋": [
    "Fresh Eggs",
    "신선한 달걀"
  ],
  "施工图纸": [
    "Construction Plans",
    "공사 도면"
  ],
  "施工许可证": [
    "The Construction Permit",
    "공사 허가증"
  ],
  "旅游手册告急": [
    "Tourist Brochures Needed",
    "관광 안내책자가 부족해요"
  ],
  "旅行相册": [
    "The Travel Album",
    "여행 사진첩"
  ],
  "旅行纪念品": [
    "Travel Souvenirs",
    "여행 기념품"
  ],
  "早报": [
    "The Morning Paper",
    "조간신문"
  ],
  "早餐面包": [
    "Bread for Breakfast",
    "아침 식사용 빵"
  ],
  "晕车的乘客": [
    "A Carsick Passenger",
    "멀미하는 승객"
  ],
  "晕车的船长": [
    "A Carsick Captain",
    "멀미하는 선장"
  ],
  "机场的急件": [
    "Urgent Airport Delivery",
    "공항 긴급 배송"
  ],
  "机密文件": [
    "Confidential Documents",
    "기밀문서"
  ],
  "样本箱": [
    "The Sample Case",
    "샘플 상자"
  ],
  "桌游之夜": [
    "Board Game Night",
    "보드게임의 밤"
  ],
  "检查报告": [
    "The Medical Report",
    "검사 결과지"
  ],
  "油漆别洒": [
    "Don't Spill the Paint",
    "페인트를 쏟지 마세요"
  ],
  "派对用的杯子": [
    "Party Cups",
    "파티용 컵"
  ],
  "派对请柬": [
    "Party Invitations",
    "파티 초대장"
  ],
  "派对零食": [
    "Party Snacks",
    "파티 간식"
  ],
  "清晨的鲜花": [
    "Fresh Morning Flowers",
    "아침의 싱싱한 꽃"
  ],
  "演出服": [
    "The Stage Costume",
    "공연 의상"
  ],
  "演唱会门票": [
    "Concert Tickets",
    "콘서트 티켓"
  ],
  "猫去哪儿了": [
    "Where Did the Cat Go?",
    "고양이는 어디에?"
  ],
  "玻璃罐香料": [
    "Spices in Glass Jars",
    "유리병에 담긴 향신료"
  ],
  "玻璃花瓶": [
    "The Glass Vase",
    "유리 꽃병"
  ],
  "生日惊喜": [
    "A Birthday Surprise",
    "생일 깜짝 선물"
  ],
  "生日蛋糕": [
    "The Birthday Cake",
    "생일 케이크"
  ],
  "电瓶没电": [
    "A Dead Car Battery",
    "방전된 배터리"
  ],
  "看不清了": [
    "I Can't See Clearly",
    "잘 안 보여요"
  ],
  "祖传菜谱": [
    "The Family Recipe",
    "가문의 요리 비법"
  ],
  "神秘包裹": [
    "The Mysterious Parcel",
    "수상한 소포"
  ],
  "精密零件": [
    "Precision Parts",
    "정밀 부품"
  ],
  "约好吃午饭": [
    "A Lunch Appointment",
    "점심 약속"
  ],
  "自制果酱": [
    "Homemade Jam",
    "수제 잼"
  ],
  "船长的葡萄干": [
    "The Captain's Raisins",
    "선장의 건포도"
  ],
  "落下的书包": [
    "The Forgotten Schoolbag",
    "두고 온 책가방"
  ],
  "落地镜": [
    "The Full-length Mirror",
    "전신거울"
  ],
  "订婚戒指": [
    "The Engagement Ring",
    "약혼반지"
  ],
  "赶去值班": [
    "Rushing to a Shift",
    "근무하러 서둘러 가기"
  ],
  "赶去接小朋友": [
    "Rushing to Pick Up the Kids",
    "아이들 데리러 서둘러 가기"
  ],
  "赶去采访": [
    "Rushing to an Interview",
    "취재하러 서둘러 가기"
  ],
  "赶在出发前": [
    "Before Departure",
    "출발 전에"
  ],
  "赶演出": [
    "Rushing to the Show",
    "공연에 늦지 않게"
  ],
  "趁热送到": [
    "Deliver It While It's Hot",
    "따뜻할 때 배달하기"
  ],
  "踢飞的足球": [
    "The Ball Kicked Away",
    "멀리 차버린 축구공"
  ],
  "还雨伞": [
    "Returning the Umbrella",
    "우산 돌려주기"
  ],
  "追查证物": [
    "Tracking Down Evidence",
    "증거물 추적"
  ],
  "追风筝": [
    "Chasing the Kite",
    "연을 쫓아서"
  ],
  "遥控卡丁车": [
    "The Remote-control Kart",
    "무선 조종 카트"
  ],
  "采购食材": [
    "Buying Ingredients",
    "식재료 구입"
  ],
  "金鱼搬家": [
    "Moving the Goldfish",
    "금붕어 이사"
  ],
  "钥匙丢了": [
    "The Lost Keys",
    "열쇠를 잃어버렸어요"
  ],
  "钱包丢了": [
    "The Lost Wallet",
    "지갑을 잃어버렸어요"
  ],
  "闯红灯的证据": [
    "Evidence of a Red-light Violation",
    "신호 위반 증거"
  ],
  "限量赛车鞋": [
    "Limited-edition Racing Shoes",
    "한정판 레이싱 슈즈"
  ],
  "霓虹招牌": [
    "The Neon Sign",
    "네온 간판"
  ],
  "预约图书": [
    "Reserved Library Books",
    "예약한 도서"
  ],
  "飞走的帽子": [
    "The Hat Blown Away",
    "날아간 모자"
  ],
  "飞走的轮毂盖": [
    "The Lost Hubcap",
    "날아간 휠 캡"
  ],
  "鸡蛋别碎": [
    "Don't Break the Eggs",
    "달걀이 깨지지 않게"
  ],
  "鸡跑了": [
    "The Chickens Escaped",
    "닭들이 도망갔어요"
  ],
  "导游 · 皮蛋": [
    "Guide · Dao",
    "가이드 · 다오"
  ],
  "交通协管员 · 小乖": [
    "Traffic Warden · Uni",
    "교통 도우미 · 우니"
  ],
  "热心市民 · 宝宝": [
    "Helpful Citizen · Bazzi",
    "친절한 시민 · 배찌"
  ],
  "店主 · 黑妞": [
    "Shopkeeper · Dizni",
    "상점 주인 · 디지니"
  ],
  "修车师傅 · 胖墩": [
    "Mechanic · Kephi",
    "정비사 · 케피"
  ],
  "机场引导员 · 葱头": [
    "Airport Marshal · Ethen",
    "공항 안내원 · 에띠"
  ],
  "巡警 · 吉米": [
    "Patrol Officer · Jimmy",
    "순경 · 지미"
  ],
  "邮差 · 小强": [
    "Postman · Xiaoqiang",
    "우편배달부 · 샤오창"
  ],
  "风筝摊主 · 雯雯": [
    "Kite Seller · Wenwen",
    "연 가게 주인 · 원원"
  ],
  "船坞老板 · 海盗船长": [
    "Dock Owner · Captain Lodumani",
    "선착장 주인 · 로두마니 선장"
  ],
  "工地主管 · 神秘工头": [
    "Site Manager · Mysterious Foreman",
    "현장 관리자 · 수수께끼의 반장"
  ],
  "校车司机 · 嘟嘟": [
    "School Bus Driver · Tutu",
    "통학버스 기사 · 투투"
  ],
  "花店店主 · 蓝蓝": [
    "Florist · Lanlan",
    "꽃집 주인 · 란란"
  ],
  "救生员 · 大海": [
    "Lifeguard · Dahai",
    "인명구조원 · 다하이"
  ],
  "冰淇淋小贩 · 糖糖": [
    "Ice Cream Seller · Tangtang",
    "아이스크림 상인 · 탕탕"
  ],
  "冲浪教练 · 阿浪": [
    "Surf Instructor · Alang",
    "서핑 강사 · 아랑"
  ],
  "沙滩排球选手 · 小麦": [
    "Beach Volleyball Player · Xiaomai",
    "비치발리볼 선수 · 샤오마이"
  ],
  "海滨摄影师 · 阿光": [
    "Seaside Photographer · Aguang",
    "해변 사진가 · 아광"
  ],
  "椰子摊主 · 椰叔": [
    "Coconut Seller · Uncle Ye",
    "코코넛 상인 · 예 아저씨"
  ],
  "酒店门童 · 小新": [
    "Hotel Bellboy · Xiaoxin",
    "호텔 도어맨 · 샤오신"
  ],
  "健身教练 · 大力": [
    "Fitness Coach · Dali",
    "피트니스 강사 · 다리"
  ],
  "咖啡师 · 阿豆": [
    "Barista · Adou",
    "바리스타 · 아더우"
  ],
  "书店店员 · 书书": [
    "Bookshop Clerk · Shushu",
    "서점 직원 · 슈슈"
  ],
  "遛狗少年 · 跳跳": [
    "Dog Walker · Tiaotiao",
    "강아지 산책 소년 · 탸오탸오"
  ],
  "报亭老板 · 老周": [
    "Newsstand Owner · Lao Zhou",
    "신문 가판대 주인 · 라오저우"
  ],
  "理发师 · 小剪": [
    "Barber · Xiaojian",
    "이발사 · 샤오젠"
  ],
  "冰沙店店员 · 果果": [
    "Smoothie Clerk · Guoguo",
    "스무디 가게 직원 · 궈궈"
  ],
  "码头工人 · 大壮": [
    "Dockworker · Dazhuang",
    "부두 노동자 · 다좡"
  ],
  "渔夫 · 老海": [
    "Fisherman · Lao Hai",
    "어부 · 라오하이"
  ],
  "游艇俱乐部经理 · 阿彬": [
    "Yacht Club Manager · Abin",
    "요트 클럽 매니저 · 아빈"
  ],
  "商场售货员 · 小美": [
    "Mall Clerk · Xiaomei",
    "쇼핑몰 점원 · 샤오메이"
  ],
  "街头魔术师 · 阿奇": [
    "Street Magician · Aqi",
    "거리 마술사 · 아치"
  ],
  "夜市摊主 · 阿香": [
    "Night Market Seller · Axiang",
    "야시장 상인 · 아샹"
  ],
  "甜品师 · 米粒": [
    "Pastry Chef · Mili",
    "디저트 셰프 · 미리"
  ],
  "公寓管理员 · 王伯": [
    "Apartment Manager · Uncle Wang",
    "아파트 관리인 · 왕 아저씨"
  ],
  "保安 · 阿虎": [
    "Security Guard · Ahu",
    "경비원 · 아후"
  ],
  "灯塔看守人 · 老灯": [
    "Lighthouse Keeper · Lao Deng",
    "등대지기 · 라오덩"
  ],
  "街头歌手 · 晴晴": [
    "Street Singer · Qingqing",
    "거리 가수 · 칭칭"
  ],
  "游客中心向导 · 安安": [
    "Visitor Center Guide · Anan",
    "관광안내소 가이드 · 안안"
  ],
  "餐厅主厨 · 大勺": [
    "Head Chef · Dashao",
    "수석 셰프 · 다샤오"
  ],
  "糖果店老板 · 甜甜": [
    "Candy Shop Owner · Tiantian",
    "사탕 가게 주인 · 톈톈"
  ],
  "面包师 · 阿麦": [
    "Baker · Amai",
    "제빵사 · 아마이"
  ],
  "舞蹈老师 · 莎莎": [
    "Dance Teacher · Shasha",
    "무용 교사 · 샤샤"
  ],
  "音乐老师 · 美玲": [
    "Music Teacher · Meiling",
    "음악 교사 · 메이링"
  ],
  "小学生 · 豆豆": [
    "Schoolchild · Doudou",
    "초등학생 · 더우더우"
  ],
  "裁缝 · 针婶": [
    "Tailor · Aunt Zhen",
    "재봉사 · 전 아주머니"
  ],
  "药店店员 · 小白": [
    "Pharmacy Clerk · Xiaobai",
    "약국 직원 · 샤오바이"
  ],
  "洗衣店老板 · 泡泡": [
    "Laundry Owner · Paopao",
    "세탁소 주인 · 파오파오"
  ],
  "杂货铺老板 · 阿宽": [
    "Grocer · Akuan",
    "잡화점 주인 · 아콴"
  ],
  "修车学徒 · 小扳": [
    "Mechanic's Apprentice · Xiaoban",
    "견습 정비사 · 샤오반"
  ],
  "回收站老板 · 老铁": [
    "Recycling Yard Owner · Lao Tie",
    "재활용장 주인 · 라오톄"
  ],
  "卡车司机 · 大刘": [
    "Truck Driver · Da Liu",
    "트럭 기사 · 다류"
  ],
  "涂装师 · 彩彩": [
    "Vehicle Painter · Caicai",
    "차량 도색사 · 차이차이"
  ],
  "零件店老板 · 阿钉": [
    "Parts Shop Owner · Ading",
    "부품점 주인 · 아딩"
  ],
  "洗车工 · 水水": [
    "Car Washer · Shuishui",
    "세차 직원 · 슈이슈이"
  ],
  "护士 · 小雪": [
    "Nurse · Xiaoxue",
    "간호사 · 샤오쉐"
  ],
  "医生 · 白大夫": [
    "Doctor · Dr. Bai",
    "의사 · 바이 선생님"
  ],
  "银行职员 · 金金": [
    "Bank Clerk · Jinjin",
    "은행원 · 진진"
  ],
  "侦探 · 福尔摩斯": [
    "Detective · Holmes",
    "탐정 · 홈즈"
  ],
  "记者 · 罗杰": [
    "Reporter · Roger",
    "기자 · 로저"
  ],
  "图书管理员 · 卡米拉": [
    "Librarian · Camilla",
    "사서 · 카밀라"
  ],
  "快递员 · 阿快": [
    "Courier · Akuai",
    "택배 기사 · 아콰이"
  ],
  "天文爱好者 · 星星": [
    "Astronomy Enthusiast · Xingxing",
    "천문 애호가 · 싱싱"
  ],
  "农场主 · 阿丰": [
    "Farmer · Afeng",
    "농장주 · 아펑"
  ],
  "邮局柜员 · 小信": [
    "Post Office Clerk · Xiaoxin",
    "우체국 직원 · 샤오신"
  ],
  "皮蛋": [
    "Dao",
    "다오"
  ],
  "小乖": [
    "Uni",
    "우니"
  ],
  "宝宝": [
    "Bazzi",
    "배찌"
  ],
  "黑妞": [
    "Dizni",
    "디지니"
  ],
  "胖墩": [
    "Kephi",
    "케피"
  ],
  "葱头": [
    "Ethen",
    "에띠"
  ],
  "吉米": [
    "Jimmy",
    "지미"
  ],
  "小强": [
    "Xiaoqiang",
    "샤오창"
  ],
  "雯雯": [
    "Wenwen",
    "원원"
  ],
  "海盗船长": [
    "Captain Lodumani",
    "로두마니 선장"
  ],
  "神秘工头": [
    "Mysterious Foreman",
    "수수께끼의 반장"
  ],
  "嘟嘟": [
    "Tutu",
    "투투"
  ],
  "蓝蓝": [
    "Lanlan",
    "란란"
  ],
  "大海": [
    "Dahai",
    "다하이"
  ],
  "糖糖": [
    "Tangtang",
    "탕탕"
  ],
  "阿浪": [
    "Alang",
    "아랑"
  ],
  "小麦": [
    "Xiaomai",
    "샤오마이"
  ],
  "阿光": [
    "Aguang",
    "아광"
  ],
  "椰叔": [
    "Uncle Ye",
    "예 아저씨"
  ],
  "小新": [
    "Xiaoxin",
    "샤오신"
  ],
  "大力": [
    "Dali",
    "다리"
  ],
  "阿豆": [
    "Adou",
    "아더우"
  ],
  "书书": [
    "Shushu",
    "슈슈"
  ],
  "跳跳": [
    "Tiaotiao",
    "탸오탸오"
  ],
  "老周": [
    "Lao Zhou",
    "라오저우"
  ],
  "小剪": [
    "Xiaojian",
    "샤오젠"
  ],
  "果果": [
    "Guoguo",
    "궈궈"
  ],
  "大壮": [
    "Dazhuang",
    "다좡"
  ],
  "老海": [
    "Lao Hai",
    "라오하이"
  ],
  "阿彬": [
    "Abin",
    "아빈"
  ],
  "小美": [
    "Xiaomei",
    "샤오메이"
  ],
  "阿奇": [
    "Aqi",
    "아치"
  ],
  "阿香": [
    "Axiang",
    "아샹"
  ],
  "米粒": [
    "Mili",
    "미리"
  ],
  "王伯": [
    "Uncle Wang",
    "왕 아저씨"
  ],
  "阿虎": [
    "Ahu",
    "아후"
  ],
  "老灯": [
    "Lao Deng",
    "라오덩"
  ],
  "晴晴": [
    "Qingqing",
    "칭칭"
  ],
  "安安": [
    "Anan",
    "안안"
  ],
  "大勺": [
    "Dashao",
    "다샤오"
  ],
  "甜甜": [
    "Tiantian",
    "톈톈"
  ],
  "阿麦": [
    "Amai",
    "아마이"
  ],
  "莎莎": [
    "Shasha",
    "샤샤"
  ],
  "美玲": [
    "Meiling",
    "메이링"
  ],
  "豆豆": [
    "Doudou",
    "더우더우"
  ],
  "针婶": [
    "Aunt Zhen",
    "전 아주머니"
  ],
  "小白": [
    "Xiaobai",
    "샤오바이"
  ],
  "泡泡": [
    "Paopao",
    "파오파오"
  ],
  "阿宽": [
    "Akuan",
    "아콴"
  ],
  "小扳": [
    "Xiaoban",
    "샤오반"
  ],
  "老铁": [
    "Lao Tie",
    "라오톄"
  ],
  "大刘": [
    "Da Liu",
    "다류"
  ],
  "彩彩": [
    "Caicai",
    "차이차이"
  ],
  "阿钉": [
    "Ading",
    "아딩"
  ],
  "水水": [
    "Shuishui",
    "슈이슈이"
  ],
  "小雪": [
    "Xiaoxue",
    "샤오쉐"
  ],
  "白大夫": [
    "Dr. Bai",
    "바이 선생님"
  ],
  "金金": [
    "Jinjin",
    "진진"
  ],
  "福尔摩斯": [
    "Holmes",
    "홈즈"
  ],
  "罗杰": [
    "Roger",
    "로저"
  ],
  "卡米拉": [
    "Camilla",
    "카밀라"
  ],
  "阿快": [
    "Akuai",
    "아콰이"
  ],
  "星星": [
    "Xingxing",
    "싱싱"
  ],
  "阿丰": [
    "Afeng",
    "아펑"
  ],
  "小信": [
    "Xiaoxin",
    "샤오신"
  ],
  "一个加急包裹": [
    "Urgent parcel",
    "긴급 소포"
  ],
  "一串备用钥匙": [
    "Spare keys",
    "예비 열쇠 꾸러미"
  ],
  "一份待签的合同": [
    "Contract to sign",
    "서명할 계약서"
  ],
  "一卷施工图纸": [
    "Construction plans",
    "공사 도면"
  ],
  "一双限量款赛车鞋": [
    "Limited-edition racing shoes",
    "한정판 레이싱 신발"
  ],
  "一叠明信片": [
    "Postcards",
    "엽서 묶음"
  ],
  "一叠派对请柬": [
    "Party invitations",
    "파티 초대장"
  ],
  "一只大风筝": [
    "Large kite",
    "큰 연"
  ],
  "一只玻璃花瓶": [
    "Glass vase",
    "유리 꽃병"
  ],
  "一块冲浪板": [
    "Surfboard",
    "서핑보드"
  ],
  "一块备用电瓶": [
    "Spare battery",
    "예비 배터리"
  ],
  "一大袋派对零食": [
    "Party snacks",
    "파티 간식 한 봉지"
  ],
  "一套卡丁车轮胎": [
    "Kart tires",
    "카트 타이어 세트"
  ],
  "一套桌游": [
    "Board game",
    "보드게임"
  ],
  "一封感谢信": [
    "Thank-you letter",
    "감사 편지"
  ],
  "一托新鲜鸡蛋": [
    "Tray of fresh eggs",
    "신선한 달걀 한 판"
  ],
  "一把借来的雨伞": [
    "Borrowed umbrella",
    "빌린 우산"
  ],
  "一捆当天的报纸": [
    "Today's newspapers",
    "오늘 신문 묶음"
  ],
  "一捆木板": [
    "Bundle of planks",
    "나무판자 묶음"
  ],
  "一摞预约的书": [
    "Reserved books",
    "예약한 책"
  ],
  "一束探病鲜花": [
    "Get-well bouquet",
    "병문안 꽃다발"
  ],
  "一桶咖啡机专用机油": [
    "Coffee machine oil",
    "커피 머신용 윤활유"
  ],
  "一桶朗姆葡萄干": [
    "Tub of rum raisins",
    "럼 건포도 한 통"
  ],
  "一盆多肉植物": [
    "Potted succulent",
    "다육식물 화분"
  ],
  "一盒急用药品": [
    "Urgent medication",
    "긴급 의약품"
  ],
  "一盒新鲜鸡蛋": [
    "Box of fresh eggs",
    "신선한 달걀 한 상자"
  ],
  "一盒旅行纪念品": [
    "Travel souvenirs",
    "여행 기념품"
  ],
  "一盒玻璃罐香料": [
    "Glass jars of spices",
    "유리병에 담긴 향신료"
  ],
  "一箱冰镇饮料": [
    "Chilled drinks",
    "차가운 음료 한 상자"
  ],
  "一箱冰鲜海鱼": [
    "Chilled sea fish",
    "냉장 생선 한 상자"
  ],
  "一箱冷藏疫苗": [
    "Refrigerated vaccines",
    "냉장 백신 한 상자"
  ],
  "一箱旅游手册": [
    "Travel guides",
    "여행 안내 책자"
  ],
  "一箱玻璃杯": [
    "Box of glasses",
    "유리컵 한 상자"
  ],
  "一箱维修工具": [
    "Repair tools",
    "수리 도구 한 상자"
  ],
  "一篮刚出炉的面包": [
    "Freshly baked bread",
    "갓 구운 빵 한 바구니"
  ],
  "一缸金鱼": [
    "Tank of goldfish",
    "금붕어 어항"
  ],
  "一罐自制果酱": [
    "Homemade jam",
    "수제 잼 한 병"
  ],
  "一袋新烘焙咖啡豆": [
    "Freshly roasted coffee beans",
    "갓 볶은 커피 원두"
  ],
  "一袋机密文件": [
    "Confidential documents",
    "기밀 서류"
  ],
  "一袋检查报告": [
    "Medical test reports",
    "검사 결과지"
  ],
  "一锅老火靓汤": [
    "Slow-cooked soup",
    "푹 끓인 수프 한 냄비"
  ],
  "一面落地镜": [
    "Full-length mirror",
    "전신 거울"
  ],
  "三层奶油生日蛋糕": [
    "Three-tier birthday cake",
    "3단 생크림 생일 케이크"
  ],
  "丢了的眼镜": [
    "Lost glasses",
    "잃어버린 안경"
  ],
  "丢失的钥匙": [
    "Lost keys",
    "잃어버린 열쇠"
  ],
  "义卖捐赠品": [
    "Charity sale donations",
    "자선 바자회 기부 물품"
  ],
  "修好的引擎零件": [
    "Repaired engine parts",
    "수리된 엔진 부품"
  ],
  "借出去的工具": [
    "Loaned tools",
    "빌려준 도구"
  ],
  "公告栏的海报": [
    "Noticeboard posters",
    "게시판의 포스터"
  ],
  "冲洗好的相册": [
    "Album of developed photos",
    "인화한 사진 앨범"
  ],
  "几桶油漆": [
    "Cans of paint",
    "페인트 몇 통"
  ],
  "刚剪下的鲜花": [
    "Fresh-cut flowers",
    "갓 자른 꽃"
  ],
  "华盛顿海滩中心花坛": [
    "Washington Beach Central Flowerbed",
    "워싱턴 비치 중앙 화단"
  ],
  "华盛顿海滩中部": [
    "Central Washington Beach",
    "워싱턴 비치 중부"
  ],
  "华盛顿海滩北部": [
    "North Washington Beach",
    "워싱턴 비치 북부"
  ],
  "华盛顿海滩南花园": [
    "Washington Beach South Garden",
    "워싱턴 비치 남쪽 정원"
  ],
  "华盛顿海滩南部": [
    "South Washington Beach",
    "워싱턴 비치 남부"
  ],
  "华盛顿海滩西花圃": [
    "Washington Beach West Flower Garden",
    "워싱턴 비치 서쪽 꽃밭"
  ],
  "华盛顿海滩西邮筒": [
    "Washington Beach West Mailbox",
    "워싱턴 비치 서쪽 우체통"
  ],
  "华盛顿海滩西部": [
    "West Washington Beach",
    "워싱턴 비치 서부"
  ],
  "双层奶油蛋糕": [
    "Two-tier cream cake",
    "2단 생크림 케이크"
  ],
  "取景照片": [
    "Location photos",
    "촬영지 사진"
  ],
  "台阶下的球": [
    "Ball below the steps",
    "계단 아래의 공"
  ],
  "各家的鸡蛋": [
    "Eggs from the neighbors",
    "이웃집 달걀"
  ],
  "墙上的海报": [
    "Posters on the wall",
    "벽에 붙은 포스터"
  ],
  "定做的演出服": [
    "Custom stage costume",
    "맞춤 공연 의상"
  ],
  "寄卖点丙": [
    "Consignment Shop C",
    "위탁 판매점 C"
  ],
  "寄卖点乙": [
    "Consignment Shop B",
    "위탁 판매점 B"
  ],
  "寄卖点甲": [
    "Consignment Shop A",
    "위탁 판매점 A"
  ],
  "寄卖的货": [
    "Consignment goods",
    "위탁 판매 물품"
  ],
  "寄回家乡的龙形风筝": [
    "Dragon kite for home",
    "고향에 보낼 용 모양 연"
  ],
  "小哈瓦那东边面包房": [
    "East Little Havana Bakery",
    "리틀 하바나 동쪽 빵집"
  ],
  "小哈瓦那东部": [
    "East Little Havana",
    "리틀 하바나 동부"
  ],
  "小哈瓦那中部": [
    "Central Little Havana",
    "리틀 하바나 중부"
  ],
  "小哈瓦那北部": [
    "North Little Havana",
    "리틀 하바나 북부"
  ],
  "小哈瓦那南边肉铺": [
    "South Little Havana Butcher",
    "리틀 하바나 남쪽 정육점"
  ],
  "小哈瓦那南部": [
    "South Little Havana",
    "리틀 하바나 남부"
  ],
  "小哈瓦那西口菜摊": [
    "West Little Havana Vegetable Stall",
    "리틀 하바나 서쪽 입구 채소 가판대"
  ],
  "小哈瓦那西部": [
    "West Little Havana",
    "리틀 하바나 서부"
  ],
  "小海地": [
    "Little Haiti",
    "리틀 하이티"
  ],
  "小海地中部": [
    "Central Little Haiti",
    "리틀 하이티 중부"
  ],
  "小海地北部": [
    "North Little Haiti",
    "리틀 하이티 북부"
  ],
  "小海地南部": [
    "South Little Haiti",
    "리틀 하이티 남부"
  ],
  "小海地西部": [
    "West Little Haiti",
    "리틀 하이티 서부"
  ],
  "居民签名": [
    "Residents' signatures",
    "주민 서명"
  ],
  "巡逻车备用钥匙": [
    "Patrol car spare key",
    "순찰차 예비 열쇠"
  ],
  "工具箱": [
    "Toolbox",
    "공구함"
  ],
  "巷口的零件箱": [
    "Parts box at the alley entrance",
    "골목 입구의 부품 상자"
  ],
  "市中心东侧工具箱": [
    "East Downtown Toolbox",
    "다운타운 동쪽 공구함"
  ],
  "市中心东部": [
    "East Downtown",
    "다운타운 동부"
  ],
  "市中心中部": [
    "Central Downtown",
    "다운타운 중부"
  ],
  "市中心北口工具箱": [
    "North Downtown Toolbox",
    "다운타운 북쪽 입구 공구함"
  ],
  "市中心北部": [
    "North Downtown",
    "다운타운 북부"
  ],
  "市中心西路工具箱": [
    "West Downtown Road Toolbox",
    "다운타운 서쪽 도로 공구함"
  ],
  "广场边的传单": [
    "Flyers by the square",
    "광장 옆의 전단지"
  ],
  "店门口的灯笼": [
    "Lantern at the shop entrance",
    "가게 입구의 등불"
  ],
  "张家的鸡舍": [
    "Zhang's Chicken Coop",
    "장 씨네 닭장"
  ],
  "拐角的零件箱": [
    "Parts box at the corner",
    "모퉁이의 부품 상자"
  ],
  "捡到的钱包": [
    "Found wallet",
    "주운 지갑"
  ],
  "掉了的戒指": [
    "Dropped ring",
    "떨어뜨린 반지"
  ],
  "掉落的手机": [
    "Dropped phone",
    "떨어뜨린 휴대폰"
  ],
  "掉落的扳手": [
    "Dropped wrench",
    "떨어뜨린 렌치"
  ],
  "接机用的花束": [
    "Airport welcome bouquet",
    "공항 마중용 꽃다발"
  ],
  "新做的霓虹招牌": [
    "New neon sign",
    "새로 만든 네온 간판"
  ],
  "新的交通指挥棒": [
    "New traffic baton",
    "새 교통 지휘봉"
  ],
  "新鲜食材": [
    "Fresh ingredients",
    "신선한 식재료"
  ],
  "旅行团的行李箱": [
    "Tour group's suitcases",
    "여행 단체의 여행 가방"
  ],
  "李家的鸡舍": [
    "Li's Chicken Coop",
    "리 씨네 닭장"
  ],
  "来路不明的包裹": [
    "Suspicious parcel",
    "출처를 알 수 없는 소포"
  ],
  "树下的灯笼": [
    "Lantern under the tree",
    "나무 아래의 등불"
  ],
  "比赛奖杯": [
    "Race trophy",
    "경주 우승컵"
  ],
  "海星岛东部": [
    "East Starfish Island",
    "스타피시 아일랜드 동부"
  ],
  "海星岛北邮筒": [
    "North Starfish Island Mailbox",
    "스타피시 아일랜드 북쪽 우체통"
  ],
  "海星岛西桥头邮筒": [
    "Starfish Island West Bridge Mailbox",
    "스타피시 아일랜드 서쪽 다리 앞 우체통"
  ],
  "海洋海滩北部": [
    "North Ocean Beach",
    "오션 비치 북부"
  ],
  "海滩中间的风筝": [
    "Kite in the middle of the beach",
    "해변 중앙의 연"
  ],
  "海滩北边的风筝": [
    "Kite at the north end of the beach",
    "해변 북쪽의 연"
  ],
  "海滩西边的风筝": [
    "Kite at the west end of the beach",
    "해변 서쪽의 연"
  ],
  "游客遗失的相机": [
    "Tourist's lost camera",
    "관광객이 잃어버린 카메라"
  ],
  "滚走的球": [
    "Ball that rolled away",
    "굴러간 공"
  ],
  "热腾腾的午餐便当": [
    "Hot lunch box",
    "따뜻한 점심 도시락"
  ],
  "热腾腾的古巴三明治": [
    "Hot Cuban sandwich",
    "따뜻한 쿠바 샌드위치"
  ],
  "王家的鸡舍": [
    "Wang's Chicken Coop",
    "왕 씨네 닭장"
  ],
  "社区投票箱": [
    "Community ballot box",
    "마을 투표함"
  ],
  "第一个取景点": [
    "Photo Spot 1",
    "첫 번째 촬영 장소"
  ],
  "第一个邮筒": [
    "Mailbox 1",
    "첫 번째 우체통"
  ],
  "第一位捐赠人": [
    "Donor 1",
    "첫 번째 기부자"
  ],
  "第一家药房": [
    "Pharmacy 1",
    "첫 번째 약국"
  ],
  "第一家邻居": [
    "Neighbor 1",
    "첫 번째 이웃집"
  ],
  "第一户人家": [
    "Household 1",
    "첫 번째 가정"
  ],
  "第三个取景点": [
    "Photo Spot 3",
    "세 번째 촬영 장소"
  ],
  "第三个邮筒": [
    "Mailbox 3",
    "세 번째 우체통"
  ],
  "第三位捐赠人": [
    "Donor 3",
    "세 번째 기부자"
  ],
  "第三家药房": [
    "Pharmacy 3",
    "세 번째 약국"
  ],
  "第三家邻居": [
    "Neighbor 3",
    "세 번째 이웃집"
  ],
  "第三户人家": [
    "Household 3",
    "세 번째 가정"
  ],
  "第二个取景点": [
    "Photo Spot 2",
    "두 번째 촬영 장소"
  ],
  "第二个邮筒": [
    "Mailbox 2",
    "두 번째 우체통"
  ],
  "第二位捐赠人": [
    "Donor 2",
    "두 번째 기부자"
  ],
  "第二家药房": [
    "Pharmacy 2",
    "두 번째 약국"
  ],
  "第二家邻居": [
    "Neighbor 2",
    "두 번째 이웃집"
  ],
  "第二户人家": [
    "Household 2",
    "두 번째 가정"
  ],
  "精密发动机零件": [
    "Precision engine parts",
    "정밀 엔진 부품"
  ],
  "罪恶角中部": [
    "Central Vice Point",
    "바이스 포인트 중부"
  ],
  "罪恶角南部": [
    "South Vice Point",
    "바이스 포인트 남부"
  ],
  "罪恶角西部": [
    "West Vice Point",
    "바이스 포인트 서부"
  ],
  "肉铺": [
    "Butcher Shop",
    "정육점"
  ],
  "节日纸灯笼": [
    "Festival paper lanterns",
    "축제용 종이 등불"
  ],
  "花坛里的球": [
    "Ball in the flowerbed",
    "화단 속의 공"
  ],
  "菜摊": [
    "Vegetable Stall",
    "채소 가판대"
  ],
  "落下的雨伞": [
    "Forgotten umbrella",
    "두고 간 우산"
  ],
  "落在校车上的书包": [
    "Schoolbag left on the bus",
    "통학버스에 두고 내린 책가방"
  ],
  "藏宝图": [
    "Treasure map",
    "보물 지도"
  ],
  "街口的灯笼": [
    "Lantern at the street entrance",
    "길목의 등불"
  ],
  "街角的传单": [
    "Flyers at the street corner",
    "길모퉁이의 전단지"
  ],
  "被丢弃的证物": [
    "Discarded evidence",
    "버려진 증거물"
  ],
  "被吹散的传单": [
    "Scattered flyers",
    "바람에 흩어진 전단지"
  ],
  "被吹走的风筝": [
    "Kite blown away",
    "바람에 날아간 연"
  ],
  "被风吹走的帽子": [
    "Hat blown away",
    "바람에 날아간 모자"
  ],
  "被风吹走的菜谱": [
    "Recipe blown away",
    "바람에 날아간 요리법"
  ],
  "调料铺": [
    "Spice Shop",
    "향신료 가게"
  ],
  "走丢的小狗": [
    "Lost puppy",
    "길 잃은 강아지"
  ],
  "走丢的猫": [
    "Lost cat",
    "길 잃은 고양이"
  ],
  "跑掉的鸡": [
    "Runaway chicken",
    "도망간 닭"
  ],
  "路口的传单": [
    "Flyers at the intersection",
    "교차로의 전단지"
  ],
  "路口监控录像带": [
    "Intersection CCTV tape",
    "교차로 감시 카메라 녹화 테이프"
  ],
  "路边的球": [
    "Ball by the road",
    "길가의 공"
  ],
  "路边的零件箱": [
    "Parts box by the road",
    "길가의 부품 상자"
  ],
  "车站的海报": [
    "Posters at the station",
    "정류장의 포스터"
  ],
  "过期的海报": [
    "Outdated posters",
    "기한이 지난 포스터"
  ],
  "遗失的工作证": [
    "Lost employee ID",
    "잃어버린 사원증"
  ],
  "遗失的样本箱": [
    "Lost sample case",
    "잃어버린 샘플 상자"
  ],
  "遗失的钱包": [
    "Lost wallet",
    "잃어버린 지갑"
  ],
  "遥控卡丁车玩具": [
    "Remote-control kart toy",
    "무선 조종 카트 장난감"
  ],
  "邮筒里的信": [
    "Letters in the mailbox",
    "우체통 속의 편지"
  ],
  "预订的药品": [
    "Reserved medication",
    "주문한 의약품"
  ],
  "飞出去的轮毂盖": [
    "Hubcap that flew off",
    "날아간 휠 캡"
  ],
  "飞走的鹦鹉": [
    "Escaped parrot",
    "날아간 앵무새"
  ],
  "华盛顿海滩": [
    "Washington Beach",
    "워싱턴 비치"
  ],
  "罪恶角": [
    "Vice Point",
    "바이스 포인트"
  ],
  "小哈瓦那": [
    "Little Havana",
    "리틀 하바나"
  ],
  "市中心": [
    "Downtown",
    "다운타운"
  ],
  "海星岛": [
    "Starfish Island",
    "스타피시 아일랜드"
  ],
  "海洋海滩": [
    "Ocean Beach",
    "오션 비치"
  ],
  "华盛顿海滩的游客服务点没有旅游手册了，皮蛋手头刚好有一箱新印的。": [
    "The visitor center at Washington Beach is out of travel guides. Dao has a box of freshly printed copies.",
    "워싱턴 비치 관광 안내소의 여행 안내 책자가 떨어졌습니다. 다오에게 마침 새로 인쇄한 책자 한 상자가 있습니다."
  ],
  "宝宝在罪恶角晒了一下午太阳，点了一大杯冰镇椰子汁——送晚了，冰就全化了。": [
    "After an afternoon in the sun at Vice Point, Bazzi ordered a large iced coconut juice. Deliver it before the ice melts.",
    "배찌는 바이스 포인트에서 오후 내내 햇볕을 쬔 뒤 시원한 코코넛 주스를 주문했습니다. 얼음이 녹기 전에 배달하세요."
  ],
  "昨晚有人在华盛顿海滩的路口连闯三个红灯，录像带要尽快交给市中心的巡警吉米。": [
    "Someone ran three red lights at Washington Beach last night. Take the CCTV tape to Officer Jimmy in Downtown as soon as possible.",
    "어젯밤 워싱턴 비치에서 누군가 신호를 세 번 위반했습니다. 녹화 테이프를 다운타운의 순경 지미에게 빨리 전달하세요."
  ],
  "一位游客把相机落在了路口岗亭，小乖认出那是皮蛋旅行团的客人。相机很娇贵，路上不能磕碰。": [
    "A tourist left a camera at the traffic booth. Uni recognized its owner from Dao's tour group. Avoid collisions; the camera is fragile.",
    "관광객이 교통 초소에 카메라를 두고 갔습니다. 우니는 주인이 다오 여행 단체의 손님임을 알아봤습니다. 카메라가 약하니 충돌을 피하세요."
  ],
  "黑妞今天过生日，宝宝偷偷订了一个三层奶油蛋糕。蛋糕经不起颠簸，车速千万不能快。": [
    "It is Dizni's birthday, and Bazzi secretly ordered a three-tier cream cake. Drive slowly to keep it from shaking apart.",
    "오늘은 디지니의 생일입니다. 배찌가 몰래 3단 생크림 케이크를 주문했습니다. 케이크가 흔들려 망가지지 않도록 천천히 운전하세요."
  ],
  "宝宝写了一叠明信片要寄给远方的赛车伙伴，得送到海星岛的邮局。": [
    "Bazzi wrote postcards to racing friends far away. Take them to the post office on Starfish Island.",
    "배찌가 멀리 있는 레이싱 친구들에게 엽서를 썼습니다. 스타피시 아일랜드의 우체국으로 가져가세요."
  ],
  "小海地的修车师傅胖墩又点了外卖。三明治要趁热吃，凉了他可是会抱怨的。": [
    "Mechanic Kephi in Little Haiti ordered takeout again. Deliver the sandwich while it is hot, or there will be complaints.",
    "리틀 하이티의 정비사 케피가 또 음식을 주문했습니다. 불평을 듣지 않으려면 샌드위치가 따뜻할 때 배달하세요."
  ],
  "宝宝要在海边公寓开派对，向黑妞借了一整箱玻璃杯。玻璃杯一碰就碎。": [
    "Bazzi is hosting a party at a seaside apartment and borrowed a box of glasses from Dizni. A collision could shatter them.",
    "배찌가 바닷가 아파트에서 파티를 열려고 디지니에게 유리컵 한 상자를 빌렸습니다. 충돌하면 깨질 수 있습니다."
  ],
  "机场的行李牵引车坏了，葱头急等胖墩修好的引擎零件。": [
    "The airport baggage tractor broke down. Ethen urgently needs the engine parts repaired by Kephi.",
    "공항 수하물 견인차가 고장 났습니다. 에띠는 케피가 수리한 엔진 부품을 급히 기다리고 있습니다."
  ],
  "黑妞的咖啡机需要专用机油保养。油桶盖子不太严实，开太快会洒出来。": [
    "Dizni's coffee machine needs special maintenance oil. The can's lid is loose, so fast driving could spill it.",
    "디지니의 커피 머신에 전용 윤활유가 필요합니다. 뚜껑이 헐거우니 빠르게 달리면 기름이 샐 수 있습니다."
  ],
  "皮蛋旅行团的一位游客把行李落在了机场，旅行团马上要出发去下一站。": [
    "A tourist in Dao's group left luggage at the airport. The group is about to leave for its next stop.",
    "다오 여행 단체의 관광객이 공항에 짐을 두고 왔습니다. 단체가 곧 다음 장소로 출발합니다."
  ],
  "机场发现一个无人认领的包裹，葱头请巡警吉米检查。里面会不会是易碎品？保险起见别乱撞。": [
    "An unclaimed parcel was found at the airport. Ethen asked Officer Jimmy to inspect it. Avoid collisions in case its contents are fragile.",
    "공항에서 주인 없는 소포가 발견되었습니다. 에띠가 순경 지미에게 검사를 부탁했습니다. 깨지는 물건일 수 있으니 충돌을 피하세요."
  ],
  "小乖的旧指挥棒用坏了，吉米从警局领了一根新的发光指挥棒。": [
    "Uni's old traffic baton broke. Jimmy picked up a new light-up baton from the police station.",
    "우니의 교통 지휘봉이 고장 났습니다. 지미가 경찰서에서 새 발광 지휘봉을 받아 왔습니다."
  ],
  "吉米的巡逻车在胖墩那里保养，备用钥匙要送过去。吉米要求送钥匙的人做守法驾驶示范。": [
    "Jimmy's patrol car is being serviced by Kephi. Deliver the spare key, and follow traffic rules as Jimmy requested.",
    "지미의 순찰차를 케피가 정비하고 있습니다. 예비 열쇠를 전달하면서 지미의 요청대로 교통 법규를 지켜 주세요."
  ],
  "黑妞网购的新咖啡豆到了，还是加急件，得在时限内送到。": [
    "Dizni's online coffee bean order has arrived as an urgent parcel. Deliver it within the time limit.",
    "디지니가 온라인으로 주문한 커피 원두가 긴급 소포로 도착했습니다. 제한 시간 안에 배달하세요."
  ],
  "机场员工食堂订了一盒海星岛农场的新鲜鸡蛋，鸡蛋可经不起撞。": [
    "The airport staff cafeteria ordered fresh eggs from a farm on Starfish Island. The eggs cannot withstand collisions.",
    "공항 직원 식당이 스타피시 아일랜드 농장의 신선한 달걀을 주문했습니다. 충돌하면 달걀이 깨집니다."
  ],
  "雯雯扎了一只最大的龙形风筝，要寄回龙之国度给家人看。风筝骨架是竹子做的，一撞就散。": [
    "Wenwen made a huge dragon kite to send home to Dragon Country. Its bamboo frame will fall apart in a collision.",
    "원원가 고향 용의 나라로 보낼 커다란 용 모양 연을 만들었습니다. 대나무 뼈대는 충돌하면 부서집니다."
  ],
  "黑妞的咖啡馆要做新甜点，向海盗船长订了一桶航海用的朗姆葡萄干。桶盖是旧船上的，开快了会晃开。": [
    "Dizni's cafe ordered rum raisins from Captain Lodumani for a new dessert. The old barrel lid may shake loose if you drive too fast.",
    "디지니의 카페가 새 디저트를 만들려고 로두마니 선장에게 럼 건포도를 주문했습니다. 낡은 통 뚜껑이 열리지 않도록 천천히 운전하세요."
  ],
  "工地今晚要封路施工，许可证得在警局下班前交给巡警吉米盖章。": [
    "The construction site will close the road tonight. Get Officer Jimmy to stamp the permit before the police office closes.",
    "오늘 밤 공사로 도로를 통제합니다. 경찰서 업무가 끝나기 전에 순경 지미에게 허가 도장을 받아야 합니다."
  ],
  "宝宝的小侄子把书包落在了校车上，里面有明天要交的作业。": [
    "Bazzi's young nephew left a schoolbag on the school bus. It contains homework due tomorrow.",
    "배찌의 어린 조카가 통학버스에 책가방을 두고 내렸습니다. 내일까지 제출할 숙제가 들어 있습니다."
  ],
  "葱头的妈妈今天坐飞机来卡丁城看他，葱头在蓝蓝的花店订了一束接机的鲜花。": [
    "Ethen's mother is flying to Kart City today. Ethen ordered a welcome bouquet from Lanlan's flower shop.",
    "에띠의 어머니가 오늘 비행기로 카트 시티에 옵니다. 에띠가 란란의 꽃집에서 마중용 꽃다발을 주문했습니다."
  ],
  "海盗船长的船舵在胖墩那里修好了，可他一坐快车就晕。车速千万不能超过 90。": [
    "Captain Lodumani's ship's wheel has been repaired by Kephi, but fast rides cause motion sickness. Keep your speed at or below 90 km/h.",
    "로두마니 선장의 배 조타기를 케피가 수리했습니다. 빠르게 달리면 멀미가 나니 시속 90 km를 넘지 마세요."
  ],
  "雯雯要去海洋海滩找皮蛋，约好了比一场赛车。她想坐车过去看看路线。": [
    "Wenwen is meeting Dao at Ocean Beach for a race and wants a ride to preview the route.",
    "원원는 오션 비치에서 다오와 경주하기로 했습니다. 미리 경로를 살펴보려고 차를 타고 가고 싶어 합니다."
  ],
  "春游的孩子们坐飞机回来了，可嘟嘟的校车偏偏在这时候抛锚。他得赶在飞机落地前到机场。": [
    "The children are flying back from their spring trip, but Tutu's school bus broke down. Get to the airport before their plane lands.",
    "봄 소풍을 다녀온 아이들이 비행기로 돌아오는데 투투의 통학버스가 고장 났습니다. 비행기가 착륙하기 전에 공항에 도착하세요."
  ],
  "皮蛋要去市中心接新的旅行团，刚换上整洁的导游制服，可不想被颠得一身褶子。": [
    "Dao needs to meet a new tour group in Downtown. Drive smoothly to keep the freshly changed guide uniform neat.",
    "다오는 다운타운에서 새 여행 단체를 맞이해야 합니다. 새로 갈아입은 안내원 제복이 구겨지지 않도록 부드럽게 운전하세요."
  ],
  "宝宝比完赛饿坏了，想去小哈瓦那吃黑妞做的古巴三明治，可他的车又被借走了。": [
    "Hungry after a race, Bazzi wants Dizni's Cuban sandwich in Little Havana, but someone has borrowed the kart again.",
    "경주를 마치고 배고픈 배찌는 리틀 하바나에서 디지니가 만든 쿠바 샌드위치를 먹고 싶지만, 또 누군가 카트를 빌려 갔습니다."
  ],
  "昨晚一阵大风，把工地的三个工具箱吹得满市中心都是。没有工具，今天的活儿就干不了。": [
    "Last night's wind scattered three construction toolboxes across Downtown. Work cannot begin without them.",
    "어젯밤 강풍에 공사장 공구함 세 개가 다운타운 곳곳으로 날아갔습니다. 도구가 없으면 오늘 일을 시작할 수 없습니다."
  ],
  "一阵海风把雯雯摊子上的三只风筝吹跑了，落在海洋海滩各处。得赶在被人捡走前找回来。": [
    "A sea breeze blew three kites from Wenwen's stall across Ocean Beach. Retrieve them before someone takes them.",
    "바닷바람에 원원의 가판대에 있던 연 세 개가 오션 비치 곳곳으로 날아갔습니다. 누가 가져가기 전에 찾아오세요."
  ],
  "小强忙着送包裹，没空去收邮筒里的信。三个邮筒都快塞满了。": [
    "Xiaoqiang is too busy delivering parcels to collect the mail. Three mailboxes are nearly full.",
    "샤오창는 소포 배달로 바빠 편지를 수거할 시간이 없습니다. 우체통 세 개가 거의 가득 찼습니다."
  ],
  "午市就要开始，黑妞的咖啡馆还缺蔬菜、面包和火腿，三家店分在小哈瓦那三个方向。": [
    "Lunch service is about to start, but Dizni's cafe still needs vegetables, bread and ham from three shops across Little Havana.",
    "점심 영업이 곧 시작되는데 디지니의 카페에는 아직 채소, 빵, 햄이 부족합니다. 리틀 하바나의 세 가게에서 가져오세요."
  ],
  "蓝蓝和三处花圃约好了今天取花。刚剪下的鲜花很娇嫩，一路颠簸花瓣就掉光了。": [
    "Lanlan arranged to collect flowers from three gardens today. Drive gently so the fresh petals do not fall off.",
    "란란는 오늘 세 꽃밭에서 꽃을 받기로 했습니다. 갓 자른 꽃잎이 떨어지지 않도록 부드럽게 운전하세요."
  ],
  "蓝蓝的小狗又溜出去玩了，最后一次有人看到它是在华盛顿海滩中部。": [
    "Lanlan's puppy slipped away to play again. It was last seen in Central Washington Beach.",
    "란란의 강아지가 또 놀러 나갔습니다. 마지막으로 목격된 곳은 워싱턴 비치 중부입니다."
  ],
  "海盗船长的藏宝图被海鸥叼走了，最后掉在了罪恶角中部的某个角落。": [
    "A seagull snatched Captain Lodumani's treasure map and dropped it somewhere in Central Vice Point.",
    "갈매기가 로두마니 선장의 보물 지도를 물고 갔다가 바이스 포인트 중부 어딘가에 떨어뜨렸습니다."
  ],
  "闯红灯的那辆卡丁车逃跑时把车牌甩掉了，车牌落在小海地一带。证物要尽快找回来。": [
    "The kart that ran the red lights lost its license plate while fleeing near Little Haiti. Recover this evidence quickly.",
    "신호를 위반하고 달아난 카트의 번호판이 리틀 하이티 근처에 떨어졌습니다. 증거물을 빨리 찾아오세요."
  ],
  "胖墩试车时一个镀金轮毂盖飞了出去，落在小哈瓦那中部。那可是客人的宝贝。": [
    "A gold-plated hubcap flew off during Kephi's test drive and landed in Central Little Havana. It is a customer's prized possession.",
    "케피가 시험 주행 중에 금도금 휠 캡을 리틀 하바나 중부에 떨어뜨렸습니다. 손님이 아끼는 물건입니다."
  ],
  "书书的旅行照片冲洗好了，装成了一本相册。": [
    "Shushu's travel photos have been developed and made into an album.",
    "슈슈의 여행 사진을 인화해 앨범으로 만들었습니다."
  ],
  "有人在皮蛋这里捡到一个钱包，里面的证件写着阿香的名字。": [
    "Someone left a found wallet with Dao. The ID inside bears Axiang's name.",
    "누군가 주운 지갑을 다오에게 맡겼습니다. 안의 신분증에는 아샹의 이름이 적혀 있습니다."
  ],
  "今晚的演唱会快开始了，蓝蓝的门票还在皮蛋这里。": [
    "Tonight's concert is about to start, but Lanlan's ticket is still with Dao.",
    "오늘 밤 공연이 곧 시작되는데 란란의 표는 아직 다오에게 있습니다."
  ],
  "皮蛋睡过了头，要赶去华盛顿海滩找小乖，再不快点就迟到了。": [
    "Dao overslept and must hurry to meet Uni in Washington Beach. There is little time left.",
    "다오가 늦잠을 잤습니다. 늦지 않으려면 워싱턴 비치에 있는 우니에게 서둘러 가야 합니다."
  ],
  "皮蛋在做一本卡丁城画册，还差三张取景照片。": [
    "Dao is making a Kart City photo book and needs three more location photos.",
    "다오가 카트 시티 사진집을 만들고 있습니다. 촬영지 사진이 세 장 더 필요합니다."
  ],
  "一阵大风把皮蛋最心爱的帽子吹走了，落在海洋海滩北部。": [
    "A gust of wind blew Dao's favorite hat into North Ocean Beach.",
    "강풍에 다오가 가장 아끼는 모자가 오션 비치 북부까지 날아갔습니다."
  ],
  "大壮预约的书到了，一大摞。": [
    "A large stack of books reserved by Dazhuang has arrived.",
    "다좡가 예약한 책이 한가득 도착했습니다."
  ],
  "老铁要的施工图纸画好了。": [
    "The construction plans requested by Lao Tie are ready.",
    "라오톄가 요청한 공사 도면이 완성되었습니다."
  ],
  "大刘那边等着签合同，下班前必须送到。": [
    "Da Liu is waiting to sign a contract. Deliver it before the end of the workday.",
    "다류가 계약서에 서명하려고 기다립니다. 퇴근 시간 전에 전달해야 합니다."
  ],
  "小乖刚做好发型，要去见小信，可不想被颠乱了。": [
    "Uni has a fresh hairstyle and is going to meet Xiaoxin. Drive gently so it stays neat.",
    "우니는 새로 머리를 하고 샤오신를 만나러 갑니다. 머리가 흐트러지지 않도록 부드럽게 운전하세요."
  ],
  "社区要办义卖，小乖联系了几位捐赠人，东西收齐后交给小麦。": [
    "For the community charity sale, Uni contacted several donors. Collect their donations and take them to Xiaomai.",
    "마을 자선 바자회를 위해 우니가 기부자들에게 연락했습니다. 물품을 모아 샤오마이에게 전달하세요."
  ],
  "小乖的鹦鹉飞出了笼子，有人在小哈瓦那东部听到它喊“开车啦”。": [
    "Uni's parrot escaped its cage. Someone heard it shouting \"Let's drive!\" in East Little Havana.",
    "우니의 앵무새가 새장을 탈출했습니다. 리틀 하바나 동부에서 \"출발하자!\"라는 소리가 들렸다고 합니다."
  ],
  "宝宝写了一封感谢信给嘟嘟，感谢上次的帮忙。": [
    "Bazzi wrote Tutu a letter of thanks for helping last time.",
    "배찌가 지난번 도움에 감사하며 투투에게 편지를 썼습니다."
  ],
  "阿宽把自己锁在门外了，备用钥匙放在宝宝这里。": [
    "Akuan is locked out. The spare keys are with Bazzi.",
    "아콴가 열쇠 없이 문을 잠가 버렸습니다. 예비 열쇠는 배찌에게 있습니다."
  ],
  "白大夫想学冲浪，借了宝宝的一块冲浪板。": [
    "Dr. Bai wants to learn surfing and borrowed a surfboard from Bazzi.",
    "바이 선생님가 서핑을 배우려고 배찌에게 서핑보드를 빌렸습니다."
  ],
  "宝宝想去华盛顿海滩找小剪买点东西。": [
    "Bazzi wants to visit Xiaojian in Washington Beach to do some shopping.",
    "배찌가 물건을 사러 워싱턴 비치의 샤오젠에게 가고 싶어 합니다."
  ],
  "宝宝发起了修路请愿，签名收齐后要交给阿豆。": [
    "Bazzi started a petition to repair the roads. Collect the signatures and deliver them to Adou.",
    "배찌가 도로 수리 청원을 시작했습니다. 서명을 모아 아더우에게 전달하세요."
  ],
  "宝宝的眼镜掉在了罪恶角西部，现在什么都看不清。": [
    "Bazzi lost a pair of glasses in West Vice Point and cannot see clearly.",
    "배찌가 바이스 포인트 서부에서 안경을 잃어버려 잘 보이지 않습니다."
  ],
  "老周要做早餐蛋饼，在黑妞这里买了一托新鲜鸡蛋。鸡蛋一撞就碎。": [
    "Lao Zhou bought a tray of fresh eggs from Dizni for breakfast pancakes. A collision will break them.",
    "라오저우가 아침 달걀 부침을 만들려고 디지니에게 신선한 달걀 한 판을 샀습니다. 충돌하면 깨집니다."
  ],
  "星星订的进口香料装在玻璃罐里，一碰就碎。": [
    "Xingxing's imported spices are packed in glass jars that will shatter in a collision.",
    "싱싱가 주문한 수입 향신료는 유리병에 담겨 있어 충돌하면 깨집니다."
  ],
  "老灯那边有人擦伤了，急需一个急救包。": [
    "Someone near Lao Deng has a scrape and urgently needs a first-aid kit.",
    "라오덩 쪽에 찰과상을 입은 사람이 있어 구급상자가 급히 필요합니다."
  ],
  "黑妞的车在神秘工头那里修好了，得过去取。": [
    "Dizni's kart has been repaired by Mysterious Foreman and needs to be collected.",
    "디지니의 카트를 수수께끼의 반장가 수리했습니다. 이제 찾으러 가야 합니다."
  ],
  "饭点快到了，黑妞还缺几样食材，三家店分在不同的街上。": [
    "Mealtime is approaching and Dizni still needs ingredients from three shops on different streets.",
    "식사 시간이 다가오는데 디지니에게 식재료가 부족합니다. 서로 다른 거리에 있는 세 가게에서 가져오세요."
  ],
  "黑妞的手机掉在了小哈瓦那北部，电量快耗光了，没电就找不到了。": [
    "Dizni dropped a phone in North Little Havana. Find it before its battery dies and it can no longer be traced.",
    "디지니가 리틀 하바나 북부에서 휴대폰을 떨어뜨렸습니다. 배터리가 꺼져 찾을 수 없게 되기 전에 찾아오세요."
  ],
  "阿光的卡丁车爆胎了，等着新轮胎才能开。": [
    "Aguang's kart has a flat tire and needs new tires before it can run again.",
    "아광의 카트 타이어가 터졌습니다. 다시 달리려면 새 타이어가 필요합니다."
  ],
  "金金新家要一面落地镜，镜子又大又脆。": [
    "Jinjin needs a full-length mirror for a new home. It is large and fragile.",
    "진진의 새집에 전신 거울이 필요합니다. 크고 깨지기 쉬운 물건입니다."
  ],
  "阿浪那边要修东西，想借胖墩的一箱维修工具。": [
    "Alang needs to make repairs and wants to borrow a box of tools from Kephi.",
    "아랑가 수리를 위해 케피에게 공구 한 상자를 빌리고 싶어 합니다."
  ],
  "胖墩要去市中心找福尔摩斯办点手续，可自己的车送去保养了。": [
    "Kephi must see Holmes in Downtown to complete some paperwork, but the kart is being serviced.",
    "케피는 서류 처리를 위해 다운타운의 홈즈를 만나야 하지만 카트가 정비 중입니다."
  ],
  "节日过去了，胖墩挂在街上的纸灯笼要收回来，纸灯笼一撞就破。": [
    "The festival is over. Collect Kephi's paper lanterns from the streets and avoid collisions; they tear easily.",
    "축제가 끝났습니다. 케피가 거리에 걸어 둔 종이 등불을 회수하세요. 쉽게 찢어지니 충돌을 피하세요."
  ],
  "胖墩那把用了二十年的幸运扳手掉在了小海地北部。": [
    "Kephi lost a lucky wrench, used for twenty years, in North Little Haiti.",
    "케피가 20년 동안 쓰던 행운의 렌치를 리틀 하이티 북부에서 잃어버렸습니다."
  ],
  "葱头分了一盆多肉植物给椰叔，花盆是陶瓷的。": [
    "Ethen is giving Uncle Ye a succulent in a ceramic pot.",
    "에띠가 예 아저씨에게 다육식물을 나눠 줍니다. 화분은 도자기입니다."
  ],
  "上次下雨，葱头借了美玲一把伞，一直没机会还。": [
    "Ethen borrowed an umbrella from Meiling when it rained and has not had a chance to return it.",
    "에띠는 비가 오던 날 메이링에게 우산을 빌렸지만 아직 돌려주지 못했습니다."
  ],
  "葱头旅行回来，给阿奇带了一盒纪念品。": [
    "Ethen returned from a trip with a box of souvenirs for Aqi.",
    "여행에서 돌아온 에띠가 아치에게 줄 기념품 한 상자를 가져왔습니다."
  ],
  "葱头要去罪恶角看晴晴的演出，眼看就要开场了。": [
    "Ethen is going to see Qingqing's show in Vice Point. The performance starts soon.",
    "에띠는 바이스 포인트에서 칭칭의 공연을 보려고 합니다. 곧 공연이 시작됩니다."
  ],
  "附近几个邮筒都满了，葱头请人帮忙把信收回来。": [
    "Nearby mailboxes are full. Ethen needs help collecting the letters.",
    "근처 우체통이 가득 찼습니다. 에띠가 편지 수거를 도와 달라고 합니다."
  ],
  "葱头的货车颠了一下，一个包裹掉在了小哈瓦那北部，客户等着要。": [
    "A bump knocked a parcel from Ethen's truck in North Little Havana. The customer is waiting for it.",
    "에띠의 트럭이 흔들리면서 소포 하나가 리틀 하바나 북부에 떨어졌습니다. 손님이 기다리고 있습니다."
  ],
  "吉米做了自制果酱，想分一罐给泡泡。玻璃罐一碰就碎。": [
    "Jimmy made jam and wants to give a jar to Paopao. The glass jar will break in a collision.",
    "지미가 만든 잼 한 병을 파오파오에게 나눠 주려고 합니다. 유리병은 충돌하면 깨집니다."
  ],
  "阿麦在比赛中得了冠军，奖杯刚刻好名字。奖杯是水晶做的。": [
    "Amai won a race. The name has just been engraved on the crystal trophy.",
    "아마이가 경주에서 우승했습니다. 크리스털 우승컵에 이름을 막 새겼습니다."
  ],
  "大海今晚办桌游之夜，借了吉米的一套桌游。": [
    "Dahai is hosting a board game night and borrowed a game from Jimmy.",
    "다하이가 오늘 밤 보드게임 모임을 열려고 지미에게 게임을 빌렸습니다."
  ],
  "吉米这几天身体不舒服，约了药店店员小白复诊。坐车颠了会头晕。": [
    "Jimmy has been unwell and has a follow-up appointment with pharmacy clerk Xiaobai. Bumpy driving causes dizziness.",
    "지미는 몸이 좋지 않아 약국 직원 샤오바이와 다시 상담하기로 했습니다. 차가 흔들리면 어지러워합니다."
  ],
  "一阵大风把吉米刚印的传单吹得满街都是。": [
    "A strong wind scattered Jimmy's freshly printed flyers all over the streets.",
    "강풍에 지미가 갓 인쇄한 전단지가 거리 곳곳으로 흩어졌습니다."
  ],
  "吉米把外婆送的雨伞落在了市中心中部。": [
    "Jimmy left a grandmother's gift umbrella in Central Downtown.",
    "지미가 할머니께 선물 받은 우산을 다운타운 중부에 두고 왔습니다."
  ],
  "小强要办派对，请柬要送到阿快那里帮忙分发。": [
    "Xiaoqiang is hosting a party. Take the invitations to Akuai for distribution.",
    "샤오창가 파티를 엽니다. 초대장을 나눠 줄 수 있도록 아콰이에게 전달하세요."
  ],
  "一个写着“加急”的包裹要送到大勺那里。": [
    "A parcel marked \"Urgent\" must be delivered to Dashao.",
    "\"긴급\"이라고 적힌 소포를 다샤오에게 전달해야 합니다."
  ],
  "阿钉领养了小强家的金鱼，鱼缸里的水满满的。": [
    "Ading adopted Xiaoqiang's goldfish. The tank is filled to the brim.",
    "아딩가 샤오창의 금붕어를 입양했습니다. 어항에 물이 가득 차 있습니다."
  ],
  "小强想顺路看看卡丁城的风景，再去小海地找小扳。": [
    "Xiaoqiang wants to enjoy Kart City's scenery on the way to see Xiaoban in Little Haiti.",
    "샤오창는 카트 시티의 경치를 구경하며 리틀 하이티의 샤오반에게 가고 싶어 합니다."
  ],
  "活动结束了，小强贴在街上的海报要赶在检查前撤下来。": [
    "The event is over. Remove Xiaoqiang's street posters before the inspection.",
    "행사가 끝났습니다. 점검 전에 샤오창가 거리에 붙인 포스터를 떼어 내세요."
  ],
  "小强的钱包不知什么时候掉在了小海地南部。": [
    "Xiaoqiang lost a wallet somewhere in South Little Haiti.",
    "샤오창가 리틀 하이티 남부 어딘가에서 지갑을 잃어버렸습니다."
  ],
  "阿丰想要一只大风筝，骨架是竹子做的，一撞就散。": [
    "Afeng wants a large kite. Its bamboo frame will fall apart in a collision.",
    "아펑가 큰 연을 원합니다. 대나무 뼈대는 충돌하면 부서집니다."
  ],
  "王伯在雯雯这里买了一只手工玻璃花瓶，一碰就碎。": [
    "Uncle Wang bought a handmade glass vase from Wenwen. A collision will shatter it.",
    "왕 아저씨가 원원에게 수제 유리 꽃병을 샀습니다. 충돌하면 깨집니다."
  ],
  "水水的咖啡豆快用完了，雯雯这里刚烘好一批。": [
    "Shuishui is running out of coffee beans. Wenwen has just roasted a fresh batch.",
    "슈이슈이의 커피 원두가 떨어져 갑니다. 원원에게 갓 볶은 원두가 있습니다."
  ],
  "雯雯一坐车就晕，可今天非去小哈瓦那找针婶不可。": [
    "Wenwen gets carsick, but must visit Aunt Zhen in Little Havana today.",
    "원원는 차를 타면 멀미가 나지만 오늘 꼭 리틀 하바나의 전 아주머니를 만나야 합니다."
  ],
  "雯雯的工具借给邻居们好久了，今天要收回来。": [
    "Wenwen lent tools to the neighbors a long time ago and needs them back today.",
    "원원가 오래전에 이웃들에게 빌려준 도구를 오늘 돌려받으려고 합니다."
  ],
  "雯雯的订婚戒指掉在了华盛顿海滩南部，今晚就要用。": [
    "Wenwen dropped an engagement ring in South Washington Beach and needs it tonight.",
    "원원가 약혼반지를 워싱턴 비치 남부에 떨어뜨렸습니다. 오늘 밤에 필요합니다."
  ],
  "大力要刷墙，订了几桶油漆。桶盖不太严实，开快了会洒。": [
    "Dali ordered paint to repaint a wall. The lids are loose, so fast driving may spill it.",
    "다리가 벽을 칠하려고 페인트를 주문했습니다. 뚜껑이 헐거우니 빠르게 달리면 샐 수 있습니다."
  ],
  "黑妞订的精密发动机零件到了，磕碰了就不能用。": [
    "Dizni's precision engine parts have arrived. Collisions would render them unusable.",
    "디지니가 주문한 정밀 엔진 부품이 도착했습니다. 충돌하면 사용할 수 없게 됩니다."
  ],
  "莎莎家的篱笆被风吹倒了，要一捆木板修补。": [
    "The wind knocked down Shasha's fence. A bundle of planks is needed for repairs.",
    "바람에 샤샤의 울타리가 무너졌습니다. 수리할 나무판자 묶음이 필요합니다."
  ],
  "海盗船长和果果约好了中午一起吃饭，想搭个顺风车。": [
    "Captain Lodumani has lunch plans with Guoguo and would like a lift.",
    "로두마니 선장는 궈궈와 점심 약속이 있어 차를 얻어 타고 싶어 합니다."
  ],
  "海盗船长的货车车门没关好，一路掉了好几箱精密零件。": [
    "Captain Lodumani's truck door was not closed properly. Several boxes of precision parts fell out along the road.",
    "로두마니 선장의 트럭 문이 제대로 닫히지 않아 정밀 부품 상자 여러 개가 길에 떨어졌습니다."
  ],
  "海盗船长在罪恶角西部散步时弄丢了一串钥匙。": [
    "Captain Lodumani lost a set of keys while walking in West Vice Point.",
    "로두마니 선장가 바이스 포인트 서부에서 산책하다가 열쇠 꾸러미를 잃어버렸습니다."
  ],
  "海盗船长的车电瓶没电了，等着备用电瓶救急。": [
    "Captain Lodumani's kart battery is dead. A spare battery is urgently needed.",
    "로두마니 선장의 카트 배터리가 방전되었습니다. 예비 배터리가 급히 필요합니다."
  ],
  "小强的怀表修好了，里面的齿轮很精细，开太快会震坏。": [
    "Xiaoqiang's pocket watch has been repaired. Its delicate gears may be damaged by driving too fast.",
    "샤오창의 회중시계를 수리했습니다. 빠르게 달리면 정교한 톱니바퀴가 손상될 수 있습니다."
  ],
  "米粒的店要换新招牌，霓虹灯管一碰就碎。": [
    "Mili's shop needs a new sign. The neon tubes break easily in a collision.",
    "미리의 가게에 새 간판이 필요합니다. 네온관은 충돌하면 쉽게 깨집니다."
  ],
  "大家给阿虎准备了生日惊喜，神秘工头得赶在阿虎回家前到场。": [
    "A surprise birthday party is ready for Ahu. Mysterious Foreman must arrive before Ahu returns home.",
    "아후를 위한 깜짝 생일 파티가 준비되었습니다. 수수께끼의 반장는 아후가 귀가하기 전에 도착해야 합니다."
  ],
  "神秘工头的工具借给邻居们好久了，今天要收回来。": [
    "Mysterious Foreman lent tools to the neighbors a long time ago and needs them back today.",
    "수수께끼의 반장가 오래전에 이웃들에게 빌려준 도구를 오늘 돌려받으려고 합니다."
  ],
  "神秘工头的猫从窗户溜了出去，最后有人在小海地南部看到它。": [
    "Mysterious Foreman's cat slipped out the window and was last seen in South Little Haiti.",
    "수수께끼의 반장의 고양이가 창문으로 빠져나갔습니다. 마지막으로 목격된 곳은 리틀 하이티 남부입니다."
  ],
  "雯雯给侄子买了一辆遥控卡丁车玩具当礼物。": [
    "Wenwen bought a remote-control kart toy as a gift for a nephew.",
    "원원가 조카에게 선물할 무선 조종 카트 장난감을 샀습니다."
  ],
  "小美领养了嘟嘟家的金鱼，鱼缸里的水满满的。": [
    "Xiaomei adopted Tutu's goldfish. The tank is filled to the brim.",
    "샤오메이가 투투의 금붕어를 입양했습니다. 어항에 물이 가득 차 있습니다."
  ],
  "胖墩那边有人擦伤了，急需一个急救包。": [
    "Someone near Kephi has a scrape and urgently needs a first-aid kit.",
    "케피 쪽에 찰과상을 입은 사람이 있어 구급상자가 급히 필요합니다."
  ],
  "嘟嘟要把一幅刚画好的画送给吉米，画框又大又脆。": [
    "Tutu wants to give Jimmy a freshly finished painting. Its frame is large and fragile.",
    "투투가 막 완성한 그림을 지미에게 주려고 합니다. 액자가 크고 약합니다."
  ],
  "嘟嘟的一袋球破了，球滚得到处都是。": [
    "Tutu's bag of balls split open, and the balls rolled everywhere.",
    "투투의 공 주머니가 찢어져 공이 사방으로 굴러갔습니다."
  ],
  "嘟嘟一脚把签名足球踢飞了，球落在了小哈瓦那中部。": [
    "Tutu kicked an autographed football too hard. It landed in Central Little Havana.",
    "투투가 사인받은 축구공을 너무 세게 차서 리틀 하바나 중부까지 날아갔습니다."
  ],
  "小新今晚有演出，定做的演出服刚刚做好。演出前必须送到。": [
    "Xiaoxin has a show tonight. The custom costume is ready and must arrive before the performance.",
    "샤오신는 오늘 밤 공연이 있습니다. 맞춤 의상이 완성되었으니 공연 전에 전달해야 합니다."
  ],
  "罗杰那边的报纸卖完了，等着新的一捆报纸。早报晚了就没人看了。": [
    "Roger sold out of newspapers and needs another bundle. Morning papers lose their readers if they arrive late.",
    "로저의 신문이 다 팔려 새 묶음이 필요합니다. 조간신문은 늦으면 아무도 읽지 않습니다."
  ],
  "葱头抢到了一双限量款赛车鞋，在蓝蓝这里等着取货。": [
    "Ethen secured a pair of limited-edition racing shoes. They are waiting at Lanlan's place.",
    "에띠가 한정판 레이싱 신발을 구했습니다. 란란의 가게에서 수령을 기다리고 있습니다."
  ],
  "蓝蓝的店里缺货了，要去卡米拉那里进一批货。": [
    "Lanlan's shop is running low on stock and needs supplies from Camilla.",
    "란란의 가게에 물건이 부족해 카밀라에게서 새 물품을 가져와야 합니다."
  ],
  "蓝蓝放在几个寄卖点的货到期了，要收回来。": [
    "Lanlan's consignment period has ended at several shops. Collect the remaining goods.",
    "여러 가게에 맡긴 란란의 물건이 위탁 기간을 넘겼습니다. 남은 물건을 회수하세요."
  ],
  "蓝蓝的手机掉在了华盛顿海滩中部，电量快耗光了，没电就找不到了。": [
    "Lanlan dropped a phone in Central Washington Beach. Find it before its battery dies and it can no longer be traced.",
    "란란가 워싱턴 비치 중부에서 휴대폰을 떨어뜨렸습니다. 배터리가 꺼져 찾을 수 없게 되기 전에 찾아오세요."
  ],
  "大海做了自制果酱，想分一罐给老海。玻璃罐一碰就碎。": [
    "Dahai made jam and wants to give a jar to Lao Hai. The glass jar will break in a collision.",
    "다하이가 만든 잼 한 병을 라오하이에게 나눠 주려고 합니다. 유리병은 충돌하면 깨집니다."
  ],
  "甜甜把自己锁在门外了，备用钥匙放在大海这里。": [
    "Tiantian is locked out. The spare keys are with Dahai.",
    "톈톈가 열쇠 없이 문을 잠가 버렸습니다. 예비 열쇠는 다하이에게 있습니다."
  ],
  "阿彬在比赛中得了冠军，奖杯刚刻好名字。奖杯是水晶做的。": [
    "Abin won a race. The name has just been engraved on the crystal trophy.",
    "아빈가 경주에서 우승했습니다. 크리스털 우승컵에 이름을 막 새겼습니다."
  ],
  "大海睡过了头，要赶去小海地找彩彩，再不快点就迟到了。": [
    "Dahai overslept and must hurry to meet Caicai in Little Haiti. There is little time left.",
    "다하이가 늦잠을 잤습니다. 늦지 않으려면 리틀 하이티에 있는 차이차이에게 서둘러 가야 합니다."
  ],
  "大海的一袋球破了，球滚得到处都是。": [
    "Dahai's bag of balls split open, and the balls rolled everywhere.",
    "다하이의 공 주머니가 찢어져 공이 사방으로 굴러갔습니다."
  ],
  "大海把外婆送的雨伞落在了小哈瓦那北部。": [
    "Dahai left a grandmother's gift umbrella in North Little Havana.",
    "다하이가 할머니께 선물 받은 우산을 리틀 하바나 북부에 두고 왔습니다."
  ],
  "豆豆每周都在糖糖这里订一篮面包，今天的刚出炉。": [
    "Doudou orders a basket of bread from Tangtang every week. Today's batch is fresh from the oven.",
    "더우더우는 매주 탕탕에게 빵 한 바구니를 주문합니다. 오늘 빵이 방금 구워졌습니다."
  ],
  "小雪忙得没空吃饭，在糖糖这里订了一份午餐便当。便当凉了就不好吃了。": [
    "Too busy to eat, Xiaoxue ordered a lunch box from Tangtang. Deliver it while it is still hot.",
    "샤오쉐는 너무 바빠 밥을 먹지 못해 탕탕에게 도시락을 주문했습니다. 식기 전에 배달하세요."
  ],
  "宝宝晚上要开派对，零食全在糖糖这里订好了。": [
    "Bazzi is throwing a party tonight and has ordered all the snacks from Tangtang.",
    "배찌가 오늘 밤 파티를 열려고 간식을 모두 탕탕에게 주문했습니다."
  ],
  "糖糖要亲手把蛋糕送给安安，自己抱着蛋糕坐车。": [
    "Tangtang wants to personally deliver a cake to Anan and will hold it during the ride.",
    "탕탕가 안안에게 케이크를 직접 전달하려고 합니다. 케이크를 안고 차를 탑니다."
  ],
  "糖糖和几户人家订了土鸡蛋，鸡蛋一碰就碎。": [
    "Tangtang ordered farm eggs from several households. Avoid collisions to keep them intact.",
    "탕탕가 여러 집에서 농장 달걀을 주문했습니다. 깨지지 않도록 충돌을 피하세요."
  ],
  "糖糖的一只鸡从笼子里跑了出去，在小哈瓦那中部到处乱窜。": [
    "One of Tangtang's chickens escaped its cage and is running around Central Little Havana.",
    "탕탕의 닭 한 마리가 우리에서 탈출해 리틀 하바나 중부 곳곳을 돌아다니고 있습니다."
  ],
  "阿浪分了一盆多肉植物给跳跳，花盆是陶瓷的。": [
    "Alang is giving Tiaotiao a succulent in a ceramic pot.",
    "아랑가 탸오탸오에게 다육식물을 나눠 줍니다. 화분은 도자기입니다."
  ],
  "今晚的演唱会快开始了，阿彬的门票还在阿浪这里。": [
    "Tonight's concert is about to start, but Abin's ticket is still with Alang.",
    "오늘 밤 공연이 곧 시작되는데 아빈의 표는 아직 아랑에게 있습니다."
  ],
  "上次下雨，阿浪借了福尔摩斯一把伞，一直没机会还。": [
    "Alang borrowed an umbrella from Holmes when it rained and has not had a chance to return it.",
    "아랑는 비가 오던 날 홈즈에게 우산을 빌렸지만 아직 돌려주지 못했습니다."
  ],
  "阿浪要把一幅刚画好的画送给白大夫，画框又大又脆。": [
    "Alang wants to give Dr. Bai a freshly finished painting. Its frame is large and fragile.",
    "아랑가 막 완성한 그림을 바이 선생님에게 주려고 합니다. 액자가 크고 약합니다."
  ],
  "阿浪在做一本卡丁城画册，还差三张取景照片。": [
    "Alang is making a Kart City photo book and needs three more location photos.",
    "아랑가 카트 시티 사진집을 만들고 있습니다. 촬영지 사진이 세 장 더 필요합니다."
  ],
  "阿浪的眼镜掉在了小哈瓦那南部，现在什么都看不清。": [
    "Alang lost a pair of glasses in South Little Havana and cannot see clearly.",
    "아랑가 리틀 하바나 남부에서 안경을 잃어버려 잘 보이지 않습니다."
  ],
  "一个写着“加急”的包裹要送到米粒那里。": [
    "A parcel marked \"Urgent\" must be delivered to Mili.",
    "\"긴급\"이라고 적힌 소포를 미리에게 전달해야 합니다."
  ],
  "小扳想要一只大风筝，骨架是竹子做的，一撞就散。": [
    "Xiaoban wants a large kite. Its bamboo frame will fall apart in a collision.",
    "샤오반가 큰 연을 원합니다. 대나무 뼈대는 충돌하면 부서집니다."
  ],
  "小麦旅行回来，给蓝蓝带了一盒纪念品。": [
    "Xiaomai returned from a trip with a box of souvenirs for Lanlan.",
    "여행에서 돌아온 샤오마이가 란란에게 줄 기념품 한 상자를 가져왔습니다."
  ],
  "小麦刚做好发型，要去见老灯，可不想被颠乱了。": [
    "Xiaomai has a fresh hairstyle and is going to meet Lao Deng. Drive gently so it stays neat.",
    "샤오마이는 새로 머리를 하고 라오덩를 만나러 갑니다. 머리가 흐트러지지 않도록 부드럽게 운전하세요."
  ],
  "活动结束了，小麦贴在街上的海报要赶在检查前撤下来。": [
    "The event is over. Remove Xiaomai's street posters before the inspection.",
    "행사가 끝났습니다. 점검 전에 샤오마이가 거리에 붙인 포스터를 떼어 내세요."
  ],
  "小麦的猫从窗户溜了出去，最后有人在海洋海滩北部看到它。": [
    "Xiaomai's cat slipped out the window and was last seen in North Ocean Beach.",
    "샤오마이의 고양이가 창문으로 빠져나갔습니다. 마지막으로 목격된 곳은 오션 비치 북부입니다."
  ],
  "莎莎前几天受了伤，朋友托阿光送一束鲜花去探望。": [
    "Shasha was injured a few days ago. Friends asked Aguang to deliver a get-well bouquet.",
    "며칠 전 샤샤가 다쳤습니다. 친구들이 아광에게 병문안 꽃다발 배달을 부탁했습니다."
  ],
  "彩彩那边的报纸卖完了，等着新的一捆报纸。早报晚了就没人看了。": [
    "Caicai sold out of newspapers and needs another bundle. Morning papers lose their readers if they arrive late.",
    "차이차이의 신문이 다 팔려 새 묶음이 필요합니다. 조간신문은 늦으면 아무도 읽지 않습니다."
  ],
  "罗杰新家要一面落地镜，镜子又大又脆。": [
    "Roger needs a full-length mirror for a new home. It is large and fragile.",
    "로저의 새집에 전신 거울이 필요합니다. 크고 깨지기 쉬운 물건입니다."
  ],
  "阿光的店里缺货了，要去大力那里进一批货。": [
    "Aguang's shop is running low on stock and needs supplies from Dali.",
    "아광의 가게에 물건이 부족해 다리에게서 새 물품을 가져와야 합니다."
  ],
  "节日过去了，阿光挂在街上的纸灯笼要收回来，纸灯笼一撞就破。": [
    "The festival is over. Collect Aguang's paper lanterns from the streets and avoid collisions; they tear easily.",
    "축제가 끝났습니다. 아광가 거리에 걸어 둔 종이 등불을 회수하세요. 쉽게 찢어지니 충돌을 피하세요."
  ],
  "阿光的鹦鹉飞出了笼子，有人在小哈瓦那南部听到它喊“开车啦”。": [
    "Aguang's parrot escaped its cage. Someone heard it shouting \"Let's drive!\" in South Little Havana.",
    "아광의 앵무새가 새장을 탈출했습니다. 리틀 하바나 남부에서 \"출발하자!\"라는 소리가 들렸다고 합니다."
  ],
  "泡泡那边热得受不了，订了一箱冰镇饮料。冰镇饮料晚了就成常温的了。": [
    "Paopao ordered chilled drinks to beat the heat. Deliver them before they warm up.",
    "파오파오가 더위를 식히려고 차가운 음료를 주문했습니다. 미지근해지기 전에 배달하세요."
  ],
  "嘟嘟身体不太舒服，椰叔熬了一锅老火靓汤要送过去。汤满满一锅，开快了会洒出来。": [
    "Tutu is feeling unwell, so Uncle Ye prepared a pot of slow-cooked soup. It is full to the brim and may spill at high speed.",
    "몸이 좋지 않은 투투를 위해 예 아저씨가 수프를 푹 끓였습니다. 냄비가 가득 차 있으니 빠르게 달리면 쏟아질 수 있습니다."
  ],
  "星星今天过生日，朋友们在椰叔这里偷偷订了一个双层奶油蛋糕。蛋糕经不起颠簸。": [
    "It is Xingxing's birthday. Friends secretly ordered a two-tier cream cake from Uncle Ye. Protect it from bumps.",
    "오늘은 싱싱의 생일입니다. 친구들이 예 아저씨에게 몰래 2단 생크림 케이크를 주문했습니다. 흔들리지 않도록 조심하세요."
  ],
  "椰叔要亲手把蛋糕送给阿虎，自己抱着蛋糕坐车。": [
    "Uncle Ye wants to personally deliver a cake to Ahu and will hold it during the ride.",
    "예 아저씨가 아후에게 케이크를 직접 전달하려고 합니다. 케이크를 안고 차를 탑니다."
  ],
  "一阵大风把椰叔刚印的传单吹得满街都是。": [
    "A strong wind scattered Uncle Ye's freshly printed flyers all over the streets.",
    "강풍에 예 아저씨가 갓 인쇄한 전단지가 거리 곳곳으로 흩어졌습니다."
  ],
  "椰叔的祖传菜谱被风吹走了，落在华盛顿海滩南部。": [
    "The wind blew Uncle Ye's family recipe into South Washington Beach.",
    "바람에 예 아저씨의 집안 대대로 내려온 요리법이 워싱턴 비치 남부까지 날아갔습니다."
  ],
  "社区投票结束了，投票箱要交给糖糖统计。投票箱要稳稳地送，路上不能出差错。": [
    "Community voting has ended. Take the ballot box safely to Tangtang for counting; nothing must go wrong en route.",
    "마을 투표가 끝났습니다. 개표를 위해 투표함을 탕탕에게 안전하게 전달하세요. 이동 중 문제가 생기면 안 됩니다."
  ],
  "一袋机密文件要亲手交给小乖。": [
    "A bag of confidential documents must be handed directly to Uni.",
    "기밀 서류 한 봉지를 우니에게 직접 전달해야 합니다."
  ],
  "阿丰预约的书到了，一大摞。": [
    "A large stack of books reserved by Afeng has arrived.",
    "아펑가 예약한 책이 한가득 도착했습니다."
  ],
  "小新约了大刘做一次采访，时间快到了。": [
    "Xiaoxin has arranged an interview with Da Liu. The appointment is soon.",
    "샤오신는 다류와 인터뷰 약속을 잡았습니다. 약속 시간이 다가옵니다."
  ],
  "社区要办义卖，小新联系了几位捐赠人，东西收齐后交给宝宝。": [
    "For the community charity sale, Xiaoxin contacted several donors. Collect their donations and take them to Bazzi.",
    "마을 자선 바자회를 위해 샤오신가 기부자들에게 연락했습니다. 물품을 모아 배찌에게 전달하세요."
  ],
  "小新的工作证掉在了华盛顿海滩南部，没有它就进不了门。": [
    "Xiaoxin lost an employee ID in South Washington Beach and cannot enter the workplace without it.",
    "샤오신가 워싱턴 비치 남부에서 사원증을 잃어버렸습니다. 사원증 없이는 직장에 들어갈 수 없습니다."
  ],
  "有人在大力这里捡到一个钱包，里面的证件写着皮蛋的名字。": [
    "Someone left a found wallet with Dali. The ID inside bears Dao's name.",
    "누군가 주운 지갑을 다리에게 맡겼습니다. 안의 신분증에는 다오의 이름이 적혀 있습니다."
  ],
  "美玲今晚办桌游之夜，借了大力的一套桌游。": [
    "Meiling is hosting a board game night and borrowed a game from Dali.",
    "메이링가 오늘 밤 보드게임 모임을 열려고 다리에게 게임을 빌렸습니다."
  ],
  "大力分了一盆多肉植物给小美，花盆是陶瓷的。": [
    "Dali is giving Xiaomei a succulent in a ceramic pot.",
    "다리가 샤오메이에게 다육식물을 나눠 줍니다. 화분은 도자기입니다."
  ],
  "大力要去小哈瓦那找小强办点手续，可自己的车送去保养了。": [
    "Dali must see Xiaoqiang in Little Havana to complete some paperwork, but the kart is being serviced.",
    "다리는 서류 처리를 위해 리틀 하바나의 샤오창를 만나야 하지만 카트가 정비 중입니다."
  ],
  "大力发起了修路请愿，签名收齐后要交给金金。": [
    "Dali started a petition to repair the roads. Collect the signatures and deliver them to Jinjin.",
    "다리가 도로 수리 청원을 시작했습니다. 서명을 모아 진진에게 전달하세요."
  ],
  "大力的钱包不知什么时候掉在了小哈瓦那北部。": [
    "Dali lost a wallet somewhere in North Little Havana.",
    "다리가 리틀 하바나 북부 어딘가에서 지갑을 잃어버렸습니다."
  ],
  "葱头要的冰鲜海鱼刚到货，冰块化完之前必须送到。": [
    "Ethen's chilled sea fish has arrived. Deliver it before the ice melts.",
    "에띠가 주문한 냉장 생선이 도착했습니다. 얼음이 녹기 전에 배달하세요."
  ],
  "豆豆晚上要开派对，零食全在阿豆这里订好了。": [
    "Doudou is throwing a party tonight and has ordered all the snacks from Adou.",
    "더우더우가 오늘 밤 파티를 열려고 간식을 모두 아더우에게 주문했습니다."
  ],
  "大海订的进口香料装在玻璃罐里，一碰就碎。": [
    "Dahai's imported spices are packed in glass jars that will shatter in a collision.",
    "다하이가 주문한 수입 향신료는 유리병에 담겨 있어 충돌하면 깨집니다."
  ],
  "大家给小新准备了生日惊喜，阿豆得赶在小新回家前到场。": [
    "A surprise birthday party is ready for Xiaoxin. Adou must arrive before Xiaoxin returns home.",
    "샤오신를 위한 깜짝 생일 파티가 준비되었습니다. 아더우는 샤오신가 귀가하기 전에 도착해야 합니다."
  ],
  "阿豆和几户人家订了土鸡蛋，鸡蛋一碰就碎。": [
    "Adou ordered farm eggs from several households. Avoid collisions to keep them intact.",
    "아더우가 여러 집에서 농장 달걀을 주문했습니다. 깨지지 않도록 충돌을 피하세요."
  ],
  "一阵大风把阿豆最心爱的帽子吹走了，落在罪恶角南部。": [
    "A gust of wind blew Adou's favorite hat into South Vice Point.",
    "강풍에 아더우가 가장 아끼는 모자가 바이스 포인트 남부까지 날아갔습니다."
  ],
  "小白的怀表修好了，里面的齿轮很精细，开太快会震坏。": [
    "Xiaobai's pocket watch has been repaired. Its delicate gears may be damaged by driving too fast.",
    "샤오바이의 회중시계를 수리했습니다. 빠르게 달리면 정교한 톱니바퀴가 손상될 수 있습니다."
  ],
  "阿香的咖啡豆快用完了，书书这里刚烘好一批。": [
    "Axiang is running out of coffee beans. Shushu has just roasted a fresh batch.",
    "아샹의 커피 원두가 떨어져 갑니다. 슈슈에게 갓 볶은 원두가 있습니다."
  ],
  "阿钉抢到了一双限量款赛车鞋，在书书这里等着取货。": [
    "Ading secured a pair of limited-edition racing shoes. They are waiting at Shushu's place.",
    "아딩가 한정판 레이싱 신발을 구했습니다. 슈슈의 가게에서 수령을 기다리고 있습니다."
  ],
  "书书一坐车就晕，可今天非去海洋海滩找椰叔不可。": [
    "Shushu gets carsick, but must visit Uncle Ye in Ocean Beach today.",
    "슈슈는 차를 타면 멀미가 나지만 오늘 꼭 오션 비치의 예 아저씨를 만나야 합니다."
  ],
  "书书放在几个寄卖点的货到期了，要收回来。": [
    "Shushu's consignment period has ended at several shops. Collect the remaining goods.",
    "여러 가게에 맡긴 슈슈의 물건이 위탁 기간을 넘겼습니다. 남은 물건을 회수하세요."
  ],
  "书书的订婚戒指掉在了华盛顿海滩北部，今晚就要用。": [
    "Shushu dropped an engagement ring in North Washington Beach and needs it tonight.",
    "슈슈가 약혼반지를 워싱턴 비치 북부에 떨어뜨렸습니다. 오늘 밤에 필요합니다."
  ],
  "大勺给侄子买了一辆遥控卡丁车玩具当礼物。": [
    "Dashao bought a remote-control kart toy as a gift for a nephew.",
    "다샤오가 조카에게 선물할 무선 조종 카트 장난감을 샀습니다."
  ],
  "跳跳写了一封感谢信给小雪，感谢上次的帮忙。": [
    "Tiaotiao wrote Xiaoxue a letter of thanks for helping last time.",
    "탸오탸오가 지난번 도움에 감사하며 샤오쉐에게 편지를 썼습니다."
  ],
  "王伯想要一只大风筝，骨架是竹子做的，一撞就散。": [
    "Uncle Wang wants a large kite. Its bamboo frame will fall apart in a collision.",
    "왕 아저씨가 큰 연을 원합니다. 대나무 뼈대는 충돌하면 부서집니다."
  ],
  "跳跳这几天身体不舒服，约了医生白大夫复诊。坐车颠了会头晕。": [
    "Tiaotiao has been unwell and has a follow-up appointment with Doctor Dr. Bai. Bumpy driving causes dizziness.",
    "탸오탸오는 몸이 좋지 않아 의사 바이 선생님에게 다시 진료받기로 했습니다. 차가 흔들리면 어지러워합니다."
  ],
  "跳跳的一袋球破了，球滚得到处都是。": [
    "Tiaotiao's bag of balls split open, and the balls rolled everywhere.",
    "탸오탸오의 공 주머니가 찢어져 공이 사방으로 굴러갔습니다."
  ],
  "跳跳在华盛顿海滩北部散步时弄丢了一串钥匙。": [
    "Tiaotiao lost a set of keys while walking in North Washington Beach.",
    "탸오탸오가 워싱턴 비치 북부에서 산책하다가 열쇠 꾸러미를 잃어버렸습니다."
  ],
  "阿豆前几天受了伤，朋友托老周送一束鲜花去探望。": [
    "Adou was injured a few days ago. Friends asked Lao Zhou to deliver a get-well bouquet.",
    "며칠 전 아더우가 다쳤습니다. 친구들이 라오저우에게 병문안 꽃다발 배달을 부탁했습니다."
  ],
  "黑妞在老周这里买了一只手工玻璃花瓶，一碰就碎。": [
    "Dizni bought a handmade glass vase from Lao Zhou. A collision will shatter it.",
    "디지니가 라오저우에게 수제 유리 꽃병을 샀습니다. 충돌하면 깨집니다."
  ],
  "胖墩的旅行照片冲洗好了，装成了一本相册。": [
    "Kephi's travel photos have been developed and made into an album.",
    "케피의 여행 사진을 인화해 앨범으로 만들었습니다."
  ],
  "老周和阿麦约好了中午一起吃饭，想搭个顺风车。": [
    "Lao Zhou has lunch plans with Amai and would like a lift.",
    "라오저우는 아마이와 점심 약속이 있어 차를 얻어 타고 싶어 합니다."
  ],
  "老周发起了修路请愿，签名收齐后要交给水水。": [
    "Lao Zhou started a petition to repair the roads. Collect the signatures and deliver them to Shuishui.",
    "라오저우가 도로 수리 청원을 시작했습니다. 서명을 모아 슈이슈이에게 전달하세요."
  ],
  "老周的货车颠了一下，一个包裹掉在了华盛顿海滩南部，客户等着要。": [
    "A bump knocked a parcel from Lao Zhou's truck in South Washington Beach. The customer is waiting for it.",
    "라오저우의 트럭이 흔들리면서 소포 하나가 워싱턴 비치 남부에 떨어졌습니다. 손님이 기다리고 있습니다."
  ],
  "海盗船长的店要换新招牌，霓虹灯管一碰就碎。": [
    "Captain Lodumani's shop needs a new sign. The neon tubes break easily in a collision.",
    "로두마니 선장의 가게에 새 간판이 필요합니다. 네온관은 충돌하면 쉽게 깨집니다."
  ],
  "老铁今晚有演出，定做的演出服刚刚做好。演出前必须送到。": [
    "Lao Tie has a show tonight. The custom costume is ready and must arrive before the performance.",
    "라오톄는 오늘 밤 공연이 있습니다. 맞춤 의상이 완성되었으니 공연 전에 전달해야 합니다."
  ],
  "雯雯那边有人擦伤了，急需一个急救包。": [
    "Someone near Wenwen has a scrape and urgently needs a first-aid kit.",
    "원원 쪽에 찰과상을 입은 사람이 있어 구급상자가 급히 필요합니다."
  ],
  "小剪的车在神秘工头那里修好了，得过去取。": [
    "Xiaojian's kart has been repaired by Mysterious Foreman and needs to be collected.",
    "샤오젠의 카트를 수수께끼의 반장가 수리했습니다. 이제 찾으러 가야 합니다."
  ],
  "社区要办义卖，小剪联系了几位捐赠人，东西收齐后交给甜甜。": [
    "For the community charity sale, Xiaojian contacted several donors. Collect their donations and take them to Tiantian.",
    "마을 자선 바자회를 위해 샤오젠가 기부자들에게 연락했습니다. 물품을 모아 톈톈에게 전달하세요."
  ],
  "小剪的钱包不知什么时候掉在了罪恶角中部。": [
    "Xiaojian lost a wallet somewhere in Central Vice Point.",
    "샤오젠가 바이스 포인트 중부 어딘가에서 지갑을 잃어버렸습니다."
  ],
  "大壮每周都在果果这里订一篮面包，今天的刚出炉。": [
    "Dazhuang orders a basket of bread from Guoguo every week. Today's batch is fresh from the oven.",
    "다좡는 매주 궈궈에게 빵 한 바구니를 주문합니다. 오늘 빵이 방금 구워졌습니다."
  ],
  "阿浪要做早餐蛋饼，在果果这里买了一托新鲜鸡蛋。鸡蛋一撞就碎。": [
    "Alang bought a tray of fresh eggs from Guoguo for breakfast pancakes. A collision will break them.",
    "아랑가 아침 달걀 부침을 만들려고 궈궈에게 신선한 달걀 한 판을 샀습니다. 충돌하면 깨집니다."
  ],
  "吉米要的冰鲜海鱼刚到货，冰块化完之前必须送到。": [
    "Jimmy's chilled sea fish has arrived. Deliver it before the ice melts.",
    "지미가 주문한 냉장 생선이 도착했습니다. 얼음이 녹기 전에 배달하세요."
  ],
  "果果想去小哈瓦那找阿宽买点东西。": [
    "Guoguo wants to visit Akuan in Little Havana to do some shopping.",
    "궈궈가 물건을 사러 리틀 하바나의 아콴에게 가고 싶어 합니다."
  ],
  "饭点快到了，果果还缺几样食材，三家店分在不同的街上。": [
    "Mealtime is approaching and Guoguo still needs ingredients from three shops on different streets.",
    "식사 시간이 다가오는데 궈궈에게 식재료가 부족합니다. 서로 다른 거리에 있는 세 가게에서 가져오세요."
  ],
  "果果的祖传菜谱被风吹走了，落在华盛顿海滩中部。": [
    "The wind blew Guoguo's family recipe into Central Washington Beach.",
    "바람에 궈궈의 집안 대대로 내려온 요리법이 워싱턴 비치 중부까지 날아갔습니다."
  ],
  "跳跳要的施工图纸画好了。": [
    "The construction plans requested by Tiaotiao are ready.",
    "탸오탸오가 요청한 공사 도면이 완성되었습니다."
  ],
  "小麦订的精密发动机零件到了，磕碰了就不能用。": [
    "Xiaomai's precision engine parts have arrived. Collisions would render them unusable.",
    "샤오마이가 주문한 정밀 엔진 부품이 도착했습니다. 충돌하면 사용할 수 없게 됩니다."
  ],
  "小信的卡丁车爆胎了，等着新轮胎才能开。": [
    "Xiaoxin's kart has a flat tire and needs new tires before it can run again.",
    "샤오신의 카트 타이어가 터졌습니다. 다시 달리려면 새 타이어가 필요합니다."
  ],
  "大壮要去罪恶角看阿奇的演出，眼看就要开场了。": [
    "Dazhuang is going to see Aqi's show in Vice Point. The performance starts soon.",
    "다좡는 바이스 포인트에서 아치의 공연을 보려고 합니다. 곧 공연이 시작됩니다."
  ],
  "大壮的货车车门没关好，一路掉了好几箱精密零件。": [
    "Dazhuang's truck door was not closed properly. Several boxes of precision parts fell out along the road.",
    "다좡의 트럭 문이 제대로 닫히지 않아 정밀 부품 상자 여러 개가 길에 떨어졌습니다."
  ],
  "大壮那把用了二十年的幸运扳手掉在了华盛顿海滩北部。": [
    "Dazhuang lost a lucky wrench, used for twenty years, in North Washington Beach.",
    "다좡가 20년 동안 쓰던 행운의 렌치를 워싱턴 비치 북부에서 잃어버렸습니다."
  ],
  "阿快忙得没空吃饭，在老海这里订了一份午餐便当。便当凉了就不好吃了。": [
    "Too busy to eat, Akuai ordered a lunch box from Lao Hai. Deliver it while it is still hot.",
    "아콰이는 너무 바빠 밥을 먹지 못해 라오하이에게 도시락을 주문했습니다. 식기 전에 배달하세요."
  ],
  "书书今天过生日，朋友们在老海这里偷偷订了一个双层奶油蛋糕。蛋糕经不起颠簸。": [
    "It is Shushu's birthday. Friends secretly ordered a two-tier cream cake from Lao Hai. Protect it from bumps.",
    "오늘은 슈슈의 생일입니다. 친구들이 라오하이에게 몰래 2단 생크림 케이크를 주문했습니다. 흔들리지 않도록 조심하세요."
  ],
  "卡米拉身体不太舒服，老海熬了一锅老火靓汤要送过去。汤满满一锅，开快了会洒出来。": [
    "Camilla is feeling unwell, so Lao Hai prepared a pot of slow-cooked soup. It is full to the brim and may spill at high speed.",
    "몸이 좋지 않은 카밀라를 위해 라오하이가 수프를 푹 끓였습니다. 냄비가 가득 차 있으니 빠르게 달리면 쏟아질 수 있습니다."
  ],
  "老海一坐车就晕，可今天非去海洋海滩找阿光不可。": [
    "Lao Hai gets carsick, but must visit Aguang in Ocean Beach today.",
    "라오하이는 차를 타면 멀미가 나지만 오늘 꼭 오션 비치의 아광를 만나야 합니다."
  ],
  "饭点快到了，老海还缺几样食材，三家店分在不同的街上。": [
    "Mealtime is approaching and Lao Hai still needs ingredients from three shops on different streets.",
    "식사 시간이 다가오는데 라오하이에게 식재료가 부족합니다. 서로 다른 거리에 있는 세 가게에서 가져오세요."
  ],
  "老海的一只鸡从笼子里跑了出去，在罪恶角中部到处乱窜。": [
    "One of Lao Hai's chickens escaped its cage and is running around Central Vice Point.",
    "라오하이의 닭 한 마리가 우리에서 탈출해 바이스 포인트 중부 곳곳을 돌아다니고 있습니다."
  ],
  "老周那边等着签合同，下班前必须送到。": [
    "Lao Zhou is waiting to sign a contract. Deliver it before the end of the workday.",
    "라오저우가 계약서에 서명하려고 기다립니다. 퇴근 시간 전에 전달해야 합니다."
  ],
  "一袋机密文件要亲手交给针婶。": [
    "A bag of confidential documents must be handed directly to Aunt Zhen.",
    "기밀 서류 한 봉지를 전 아주머니에게 직접 전달해야 합니다."
  ],
  "阿彬要办派对，请柬要送到果果那里帮忙分发。": [
    "Abin is hosting a party. Take the invitations to Guoguo for distribution.",
    "아빈가 파티를 엽니다. 초대장을 나눠 줄 수 있도록 궈궈에게 전달하세요."
  ],
  "阿彬想顺路看看卡丁城的风景，再去华盛顿海滩找小剪。": [
    "Abin wants to enjoy Kart City's scenery on the way to see Xiaojian in Washington Beach.",
    "아빈는 카트 시티의 경치를 구경하며 워싱턴 비치의 샤오젠에게 가고 싶어 합니다."
  ],
  "附近几个邮筒都满了，阿彬请人帮忙把信收回来。": [
    "Nearby mailboxes are full. Abin needs help collecting the letters.",
    "근처 우체통이 가득 찼습니다. 아빈가 편지 수거를 도와 달라고 합니다."
  ],
  "阿彬的工作证掉在了罪恶角西部，没有它就进不了门。": [
    "Abin lost an employee ID in West Vice Point and cannot enter the workplace without it.",
    "아빈가 바이스 포인트 서부에서 사원증을 잃어버렸습니다. 사원증 없이는 직장에 들어갈 수 없습니다."
  ],
  "老海新家要一面落地镜，镜子又大又脆。": [
    "Lao Hai needs a full-length mirror for a new home. It is large and fragile.",
    "라오하이의 새집에 전신 거울이 필요합니다. 크고 깨지기 쉬운 물건입니다."
  ],
  "安安领养了小美家的金鱼，鱼缸里的水满满的。": [
    "Anan adopted Xiaomei's goldfish. The tank is filled to the brim.",
    "안안가 샤오메이의 금붕어를 입양했습니다. 어항에 물이 가득 차 있습니다."
  ],
  "有人在小美这里捡到一个钱包，里面的证件写着糖糖的名字。": [
    "Someone left a found wallet with Xiaomei. The ID inside bears Tangtang's name.",
    "누군가 주운 지갑을 샤오메이에게 맡겼습니다. 안의 신분증에는 탕탕의 이름이 적혀 있습니다."
  ],
  "小美的车在水水那里修好了，得过去取。": [
    "Xiaomei's kart has been repaired by Shuishui and needs to be collected.",
    "샤오메이의 카트를 슈이슈이가 수리했습니다. 이제 찾으러 가야 합니다."
  ],
  "节日过去了，小美挂在街上的纸灯笼要收回来，纸灯笼一撞就破。": [
    "The festival is over. Collect Xiaomei's paper lanterns from the streets and avoid collisions; they tear easily.",
    "축제가 끝났습니다. 샤오메이가 거리에 걸어 둔 종이 등불을 회수하세요. 쉽게 찢어지니 충돌을 피하세요."
  ],
  "小美的眼镜掉在了罪恶角中部，现在什么都看不清。": [
    "Xiaomei lost a pair of glasses in Central Vice Point and cannot see clearly.",
    "샤오메이가 바이스 포인트 중부에서 안경을 잃어버려 잘 보이지 않습니다."
  ],
  "皮蛋想学冲浪，借了阿奇的一块冲浪板。": [
    "Dao wants to learn surfing and borrowed a surfboard from Aqi.",
    "다오가 서핑을 배우려고 아치에게 서핑보드를 빌렸습니다."
  ],
  "阿奇做了自制果酱，想分一罐给小美。玻璃罐一碰就碎。": [
    "Aqi made jam and wants to give a jar to Xiaomei. The glass jar will break in a collision.",
    "아치가 만든 잼 한 병을 샤오메이에게 나눠 주려고 합니다. 유리병은 충돌하면 깨집니다."
  ],
  "上次下雨，阿奇借了王伯一把伞，一直没机会还。": [
    "Aqi borrowed an umbrella from Uncle Wang when it rained and has not had a chance to return it.",
    "아치는 비가 오던 날 왕 아저씨에게 우산을 빌렸지만 아직 돌려주지 못했습니다."
  ],
  "阿奇和糖糖约好了中午一起吃饭，想搭个顺风车。": [
    "Aqi has lunch plans with Tangtang and would like a lift.",
    "아치는 탕탕와 점심 약속이 있어 차를 얻어 타고 싶어 합니다."
  ],
  "阿奇在做一本卡丁城画册，还差三张取景照片。": [
    "Aqi is making a Kart City photo book and needs three more location photos.",
    "아치가 카트 시티 사진집을 만들고 있습니다. 촬영지 사진이 세 장 더 필요합니다."
  ],
  "阿奇一脚把签名足球踢飞了，球落在了华盛顿海滩北部。": [
    "Aqi kicked an autographed football too hard. It landed in North Washington Beach.",
    "아치가 사인받은 축구공을 너무 세게 차서 워싱턴 비치 북부까지 날아갔습니다."
  ],
  "莎莎那边热得受不了，订了一箱冰镇饮料。冰镇饮料晚了就成常温的了。": [
    "Shasha ordered chilled drinks to beat the heat. Deliver them before they warm up.",
    "샤샤가 더위를 식히려고 차가운 음료를 주문했습니다. 미지근해지기 전에 배달하세요."
  ],
  "吉米要做早餐蛋饼，在阿香这里买了一托新鲜鸡蛋。鸡蛋一撞就碎。": [
    "Jimmy bought a tray of fresh eggs from Axiang for breakfast pancakes. A collision will break them.",
    "지미가 아침 달걀 부침을 만들려고 아샹에게 신선한 달걀 한 판을 샀습니다. 충돌하면 깨집니다."
  ],
  "小信的咖啡豆快用完了，阿香这里刚烘好一批。": [
    "Xiaoxin is running out of coffee beans. Axiang has just roasted a fresh batch.",
    "샤오신의 커피 원두가 떨어져 갑니다. 아샹에게 갓 볶은 원두가 있습니다."
  ],
  "阿香要去华盛顿海滩看大力的演出，眼看就要开场了。": [
    "Axiang is going to see Dali's show in Washington Beach. The performance starts soon.",
    "아샹는 워싱턴 비치에서 다리의 공연을 보려고 합니다. 곧 공연이 시작됩니다."
  ],
  "一阵大风把阿香刚印的传单吹得满街都是。": [
    "A strong wind scattered Axiang's freshly printed flyers all over the streets.",
    "강풍에 아샹가 갓 인쇄한 전단지가 거리 곳곳으로 흩어졌습니다."
  ],
  "阿香的祖传菜谱被风吹走了，落在罪恶角中部。": [
    "The wind blew Axiang's family recipe into Central Vice Point.",
    "바람에 아샹의 집안 대대로 내려온 요리법이 바이스 포인트 중부까지 날아갔습니다."
  ],
  "跳跳身体不太舒服，米粒熬了一锅老火靓汤要送过去。汤满满一锅，开快了会洒出来。": [
    "Tiaotiao is feeling unwell, so Mili prepared a pot of slow-cooked soup. It is full to the brim and may spill at high speed.",
    "몸이 좋지 않은 탸오탸오를 위해 미리가 수프를 푹 끓였습니다. 냄비가 가득 차 있으니 빠르게 달리면 쏟아질 수 있습니다."
  ],
  "阿宽把自己锁在门外了，备用钥匙放在米粒这里。": [
    "Akuan is locked out. The spare keys are with Mili.",
    "아콴가 열쇠 없이 문을 잠가 버렸습니다. 예비 열쇠는 미리에게 있습니다."
  ],
  "豆豆订的进口香料装在玻璃罐里，一碰就碎。": [
    "Doudou's imported spices are packed in glass jars that will shatter in a collision.",
    "더우더우가 주문한 수입 향신료는 유리병에 담겨 있어 충돌하면 깨집니다."
  ],
  "米粒要亲手把蛋糕送给葱头，自己抱着蛋糕坐车。": [
    "Mili wants to personally deliver a cake to Ethen and will hold it during the ride.",
    "미리가 에띠에게 케이크를 직접 전달하려고 합니다. 케이크를 안고 차를 탑니다."
  ],
  "米粒和几户人家订了土鸡蛋，鸡蛋一碰就碎。": [
    "Mili ordered farm eggs from several households. Avoid collisions to keep them intact.",
    "미리가 여러 집에서 농장 달걀을 주문했습니다. 깨지지 않도록 충돌을 피하세요."
  ],
  "米粒的猫从窗户溜了出去，最后有人在罪恶角西部看到它。": [
    "Mili's cat slipped out the window and was last seen in West Vice Point.",
    "미리의 고양이가 창문으로 빠져나갔습니다. 마지막으로 목격된 곳은 바이스 포인트 서부입니다."
  ],
  "阿豆的车电瓶没电了，等着备用电瓶救急。": [
    "Adou's kart battery is dead. A spare battery is urgently needed.",
    "아더우의 카트 배터리가 방전되었습니다. 예비 배터리가 급히 필요합니다."
  ],
  "泡泡要刷墙，订了几桶油漆。桶盖不太严实，开快了会洒。": [
    "Paopao ordered paint to repaint a wall. The lids are loose, so fast driving may spill it.",
    "파오파오가 벽을 칠하려고 페인트를 주문했습니다. 뚜껑이 헐거우니 빠르게 달리면 샐 수 있습니다."
  ],
  "小乖那边要修东西，想借王伯的一箱维修工具。": [
    "Uni needs to make repairs and wants to borrow a box of tools from Uncle Wang.",
    "우니가 수리를 위해 왕 아저씨에게 공구 한 상자를 빌리고 싶어 합니다."
  ],
  "王伯想去华盛顿海滩找书书买点东西。": [
    "Uncle Wang wants to visit Shushu in Washington Beach to do some shopping.",
    "왕 아저씨가 물건을 사러 워싱턴 비치의 슈슈에게 가고 싶어 합니다."
  ],
  "王伯的工具借给邻居们好久了，今天要收回来。": [
    "Uncle Wang lent tools to the neighbors a long time ago and needs them back today.",
    "왕 아저씨가 오래전에 이웃들에게 빌려준 도구를 오늘 돌려받으려고 합니다."
  ],
  "王伯在市中心北部散步时弄丢了一串钥匙。": [
    "Uncle Wang lost a set of keys while walking in North Downtown.",
    "왕 아저씨가 다운타운 북부에서 산책하다가 열쇠 꾸러미를 잃어버렸습니다."
  ],
  "社区投票结束了，投票箱要交给晴晴统计。投票箱要稳稳地送，路上不能出差错。": [
    "Community voting has ended. Take the ballot box safely to Qingqing for counting; nothing must go wrong en route.",
    "마을 투표가 끝났습니다. 개표를 위해 투표함을 칭칭에게 안전하게 전달하세요. 이동 중 문제가 생기면 안 됩니다."
  ],
  "皮蛋要的施工图纸画好了。": [
    "The construction plans requested by Dao are ready.",
    "다오가 요청한 공사 도면이 완성되었습니다."
  ],
  "蓝蓝在比赛中得了冠军，奖杯刚刻好名字。奖杯是水晶做的。": [
    "Lanlan won a race. The name has just been engraved on the crystal trophy.",
    "란란가 경주에서 우승했습니다. 크리스털 우승컵에 이름을 막 새겼습니다."
  ],
  "阿虎约了大海做一次采访，时间快到了。": [
    "Ahu has arranged an interview with Dahai. The appointment is soon.",
    "아후는 다하이와 인터뷰 약속을 잡았습니다. 약속 시간이 다가옵니다."
  ],
  "附近几个邮筒都满了，阿虎请人帮忙把信收回来。": [
    "Nearby mailboxes are full. Ahu needs help collecting the letters.",
    "근처 우체통이 가득 찼습니다. 아후가 편지 수거를 도와 달라고 합니다."
  ],
  "一阵大风把阿虎最心爱的帽子吹走了，落在罪恶角西部。": [
    "A gust of wind blew Ahu's favorite hat into West Vice Point.",
    "강풍에 아후가 가장 아끼는 모자가 바이스 포인트 서부까지 날아갔습니다."
  ],
  "黑妞家的篱笆被风吹倒了，要一捆木板修补。": [
    "The wind knocked down Dizni's fence. A bundle of planks is needed for repairs.",
    "바람에 디지니의 울타리가 무너졌습니다. 수리할 나무판자 묶음이 필요합니다."
  ],
  "阿丰的店要换新招牌，霓虹灯管一碰就碎。": [
    "Afeng's shop needs a new sign. The neon tubes break easily in a collision.",
    "아펑의 가게에 새 간판이 필요합니다. 네온관은 충돌하면 쉽게 깨집니다."
  ],
  "老灯旅行回来，给神秘工头带了一盒纪念品。": [
    "Lao Deng returned from a trip with a box of souvenirs for Mysterious Foreman.",
    "여행에서 돌아온 라오덩가 수수께끼의 반장에게 줄 기념품 한 상자를 가져왔습니다."
  ],
  "大家给甜甜准备了生日惊喜，老灯得赶在甜甜回家前到场。": [
    "A surprise birthday party is ready for Tiantian. Lao Deng must arrive before Tiantian returns home.",
    "톈톈를 위한 깜짝 생일 파티가 준비되었습니다. 라오덩는 톈톈가 귀가하기 전에 도착해야 합니다."
  ],
  "老灯的货车车门没关好，一路掉了好几箱精密零件。": [
    "Lao Deng's truck door was not closed properly. Several boxes of precision parts fell out along the road.",
    "라오덩의 트럭 문이 제대로 닫히지 않아 정밀 부품 상자 여러 개가 길에 떨어졌습니다."
  ],
  "老灯的手机掉在了罪恶角中部，电量快耗光了，没电就找不到了。": [
    "Lao Deng dropped a phone in Central Vice Point. Find it before its battery dies and it can no longer be traced.",
    "라오덩가 바이스 포인트 중부에서 휴대폰을 떨어뜨렸습니다. 배터리가 꺼져 찾을 수 없게 되기 전에 찾아오세요."
  ],
  "老铁今晚办桌游之夜，借了晴晴的一套桌游。": [
    "Lao Tie is hosting a board game night and borrowed a game from Qingqing.",
    "라오톄가 오늘 밤 보드게임 모임을 열려고 칭칭에게 게임을 빌렸습니다."
  ],
  "晴晴要办派对，请柬要送到椰叔那里帮忙分发。": [
    "Qingqing is hosting a party. Take the invitations to Uncle Ye for distribution.",
    "칭칭가 파티를 엽니다. 초대장을 나눠 줄 수 있도록 예 아저씨에게 전달하세요."
  ],
  "一个写着“加急”的包裹要送到胖墩那里。": [
    "A parcel marked \"Urgent\" must be delivered to Kephi.",
    "\"긴급\"이라고 적힌 소포를 케피에게 전달해야 합니다."
  ],
  "晴晴想顺路看看卡丁城的风景，再去市中心找金金。": [
    "Qingqing wants to enjoy Kart City's scenery on the way to see Jinjin in Downtown.",
    "칭칭는 카트 시티의 경치를 구경하며 다운타운의 진진에게 가고 싶어 합니다."
  ],
  "活动结束了，晴晴贴在街上的海报要赶在检查前撤下来。": [
    "The event is over. Remove Qingqing's street posters before the inspection.",
    "행사가 끝났습니다. 점검 전에 칭칭가 거리에 붙인 포스터를 떼어 내세요."
  ],
  "晴晴的鹦鹉飞出了笼子，有人在罪恶角西部听到它喊“开车啦”。": [
    "Qingqing's parrot escaped its cage. Someone heard it shouting \"Let's drive!\" in West Vice Point.",
    "칭칭의 앵무새가 새장을 탈출했습니다. 바이스 포인트 서부에서 \"출발하자!\"라는 소리가 들렸다고 합니다."
  ],
  "针婶那边等着签合同，下班前必须送到。": [
    "Aunt Zhen is waiting to sign a contract. Deliver it before the end of the workday.",
    "전 아주머니가 계약서에 서명하려고 기다립니다. 퇴근 시간 전에 전달해야 합니다."
  ],
  "社区投票结束了，投票箱要交给小新统计。投票箱要稳稳地送，路上不能出差错。": [
    "Community voting has ended. Take the ballot box safely to Xiaoxin for counting; nothing must go wrong en route.",
    "마을 투표가 끝났습니다. 개표를 위해 투표함을 샤오신에게 안전하게 전달하세요. 이동 중 문제가 생기면 안 됩니다."
  ],
  "星星那边的报纸卖完了，等着新的一捆报纸。早报晚了就没人看了。": [
    "Xingxing sold out of newspapers and needs another bundle. Morning papers lose their readers if they arrive late.",
    "싱싱의 신문이 다 팔려 새 묶음이 필요합니다. 조간신문은 늦으면 아무도 읽지 않습니다."
  ],
  "安安刚做好发型，要去见小麦，可不想被颠乱了。": [
    "Anan has a fresh hairstyle and is going to meet Xiaomai. Drive gently so it stays neat.",
    "안안는 새로 머리를 하고 샤오마이를 만나러 갑니다. 머리가 흐트러지지 않도록 부드럽게 운전하세요."
  ],
  "活动结束了，安安贴在街上的海报要赶在检查前撤下来。": [
    "The event is over. Remove Anan's street posters before the inspection.",
    "행사가 끝났습니다. 점검 전에 안안가 거리에 붙인 포스터를 떼어 내세요."
  ],
  "安安把外婆送的雨伞落在了海星岛东部。": [
    "Anan left a grandmother's gift umbrella in East Starfish Island.",
    "안안가 할머니께 선물 받은 우산을 스타피시 아일랜드 동부에 두고 왔습니다."
  ],
  "米粒忙得没空吃饭，在大勺这里订了一份午餐便当。便当凉了就不好吃了。": [
    "Too busy to eat, Mili ordered a lunch box from Dashao. Deliver it while it is still hot.",
    "미리는 너무 바빠 밥을 먹지 못해 다샤오에게 도시락을 주문했습니다. 식기 전에 배달하세요."
  ],
  "大壮今天过生日，朋友们在大勺这里偷偷订了一个双层奶油蛋糕。蛋糕经不起颠簸。": [
    "It is Dazhuang's birthday. Friends secretly ordered a two-tier cream cake from Dashao. Protect it from bumps.",
    "오늘은 다좡의 생일입니다. 친구들이 다샤오에게 몰래 2단 생크림 케이크를 주문했습니다. 흔들리지 않도록 조심하세요."
  ],
  "老海那边热得受不了，订了一箱冰镇饮料。冰镇饮料晚了就成常温的了。": [
    "Lao Hai ordered chilled drinks to beat the heat. Deliver them before they warm up.",
    "라오하이가 더위를 식히려고 차가운 음료를 주문했습니다. 미지근해지기 전에 배달하세요."
  ],
  "大勺的店里缺货了，要去宝宝那里进一批货。": [
    "Dashao's shop is running low on stock and needs supplies from Bazzi.",
    "다샤오의 가게에 물건이 부족해 배찌에게서 새 물품을 가져와야 합니다."
  ],
  "大勺和几户人家订了土鸡蛋，鸡蛋一碰就碎。": [
    "Dashao ordered farm eggs from several households. Avoid collisions to keep them intact.",
    "다샤오가 여러 집에서 농장 달걀을 주문했습니다. 깨지지 않도록 충돌을 피하세요."
  ],
  "大勺的订婚戒指掉在了小海地北部，今晚就要用。": [
    "Dashao dropped an engagement ring in North Little Haiti and needs it tonight.",
    "다샤오가 약혼반지를 리틀 하이티 북부에 떨어뜨렸습니다. 오늘 밤에 필요합니다."
  ],
  "福尔摩斯要的冰鲜海鱼刚到货，冰块化完之前必须送到。": [
    "Holmes's chilled sea fish has arrived. Deliver it before the ice melts.",
    "홈즈가 주문한 냉장 생선이 도착했습니다. 얼음이 녹기 전에 배달하세요."
  ],
  "甜甜写了一封感谢信给大刘，感谢上次的帮忙。": [
    "Tiantian wrote Da Liu a letter of thanks for helping last time.",
    "톈톈가 지난번 도움에 감사하며 다류에게 편지를 썼습니다."
  ],
  "阿浪晚上要开派对，零食全在甜甜这里订好了。": [
    "Alang is throwing a party tonight and has ordered all the snacks from Tiantian.",
    "아랑가 오늘 밤 파티를 열려고 간식을 모두 톈톈에게 주문했습니다."
  ],
  "甜甜睡过了头，要赶去小哈瓦那找美玲，再不快点就迟到了。": [
    "Tiantian overslept and must hurry to meet Meiling in Little Havana. There is little time left.",
    "톈톈가 늦잠을 잤습니다. 늦지 않으려면 리틀 하바나에 있는 메이링에게 서둘러 가야 합니다."
  ],
  "社区要办义卖，甜甜联系了几位捐赠人，东西收齐后交给小剪。": [
    "For the community charity sale, Tiantian contacted several donors. Collect their donations and take them to Xiaojian.",
    "마을 자선 바자회를 위해 톈톈가 기부자들에게 연락했습니다. 물품을 모아 샤오젠에게 전달하세요."
  ],
  "甜甜的一只鸡从笼子里跑了出去，在华盛顿海滩南部到处乱窜。": [
    "One of Tiantian's chickens escaped its cage and is running around South Washington Beach.",
    "톈톈의 닭 한 마리가 우리에서 탈출해 워싱턴 비치 남부 곳곳을 돌아다니고 있습니다."
  ],
  "老周每周都在阿麦这里订一篮面包，今天的刚出炉。": [
    "Lao Zhou orders a basket of bread from Amai every week. Today's batch is fresh from the oven.",
    "라오저우는 매주 아마이에게 빵 한 바구니를 주문합니다. 오늘 빵이 방금 구워졌습니다."
  ],
  "小雪今天过生日，朋友们在阿麦这里偷偷订了一个双层奶油蛋糕。蛋糕经不起颠簸。": [
    "It is Xiaoxue's birthday. Friends secretly ordered a two-tier cream cake from Amai. Protect it from bumps.",
    "오늘은 샤오쉐의 생일입니다. 친구들이 아마이에게 몰래 2단 생크림 케이크를 주문했습니다. 흔들리지 않도록 조심하세요."
  ],
  "阿麦分了一盆多肉植物给老灯，花盆是陶瓷的。": [
    "Amai is giving Lao Deng a succulent in a ceramic pot.",
    "아마이가 라오덩에게 다육식물을 나눠 줍니다. 화분은 도자기입니다."
  ],
  "阿麦这几天身体不舒服，约了药店店员小白复诊。坐车颠了会头晕。": [
    "Amai has been unwell and has a follow-up appointment with pharmacy clerk Xiaobai. Bumpy driving causes dizziness.",
    "아마이는 몸이 좋지 않아 약국 직원 샤오바이와 다시 상담하기로 했습니다. 차가 흔들리면 어지러워합니다."
  ],
  "饭点快到了，阿麦还缺几样食材，三家店分在不同的街上。": [
    "Mealtime is approaching and Amai still needs ingredients from three shops on different streets.",
    "식사 시간이 다가오는데 아마이에게 식재료가 부족합니다. 서로 다른 거리에 있는 세 가게에서 가져오세요."
  ],
  "一阵大风把阿麦最心爱的帽子吹走了，落在小哈瓦那北部。": [
    "A gust of wind blew Amai's favorite hat into North Little Havana.",
    "강풍에 아마이가 가장 아끼는 모자가 리틀 하바나 북부까지 날아갔습니다."
  ],
  "嘟嘟的旅行照片冲洗好了，装成了一本相册。": [
    "Tutu's travel photos have been developed and made into an album.",
    "투투의 여행 사진을 인화해 앨범으로 만들었습니다."
  ],
  "今晚的演唱会快开始了，阿香的门票还在莎莎这里。": [
    "Tonight's concert is about to start, but Axiang's ticket is still with Shasha.",
    "오늘 밤 공연이 곧 시작되는데 아샹의 표는 아직 샤샤에게 있습니다."
  ],
  "莎莎要把一幅刚画好的画送给彩彩，画框又大又脆。": [
    "Shasha wants to give Caicai a freshly finished painting. Its frame is large and fragile.",
    "샤샤가 막 완성한 그림을 차이차이에게 주려고 합니다. 액자가 크고 약합니다."
  ],
  "莎莎在做一本卡丁城画册，还差三张取景照片。": [
    "Shasha is making a Kart City photo book and needs three more location photos.",
    "샤샤가 카트 시티 사진집을 만들고 있습니다. 촬영지 사진이 세 장 더 필요합니다."
  ],
  "莎莎一脚把签名足球踢飞了，球落在了华盛顿海滩西部。": [
    "Shasha kicked an autographed football too hard. It landed in West Washington Beach.",
    "샤샤가 사인받은 축구공을 너무 세게 차서 워싱턴 비치 서부까지 날아갔습니다."
  ],
  "阿光预约的书到了，一大摞。": [
    "A large stack of books reserved by Aguang has arrived.",
    "아광가 예약한 책이 한가득 도착했습니다."
  ],
  "一袋机密文件要亲手交给卡米拉。": [
    "A bag of confidential documents must be handed directly to Camilla.",
    "기밀 서류 한 봉지를 카밀라에게 직접 전달해야 합니다."
  ],
  "美玲做了自制果酱，想分一罐给阿虎。玻璃罐一碰就碎。": [
    "Meiling made jam and wants to give a jar to Ahu. The glass jar will break in a collision.",
    "메이링가 만든 잼 한 병을 아후에게 나눠 주려고 합니다. 유리병은 충돌하면 깨집니다."
  ],
  "美玲约了小扳做一次采访，时间快到了。": [
    "Meiling has arranged an interview with Xiaoban. The appointment is soon.",
    "메이링는 샤오반와 인터뷰 약속을 잡았습니다. 약속 시간이 다가옵니다."
  ],
  "附近几个邮筒都满了，美玲请人帮忙把信收回来。": [
    "Nearby mailboxes are full. Meiling needs help collecting the letters.",
    "근처 우체통이 가득 찼습니다. 메이링가 편지 수거를 도와 달라고 합니다."
  ],
  "美玲的货车颠了一下，一个包裹掉在了小哈瓦那南部，客户等着要。": [
    "A bump knocked a parcel from Meiling's truck in South Little Havana. The customer is waiting for it.",
    "메이링의 트럭이 흔들리면서 소포 하나가 리틀 하바나 남부에 떨어졌습니다. 손님이 기다리고 있습니다."
  ],
  "晴晴想学冲浪，借了豆豆的一块冲浪板。": [
    "Qingqing wants to learn surfing and borrowed a surfboard from Doudou.",
    "칭칭가 서핑을 배우려고 더우더우에게 서핑보드를 빌렸습니다."
  ],
  "小强那边有人擦伤了，急需一个急救包。": [
    "Someone near Xiaoqiang has a scrape and urgently needs a first-aid kit.",
    "샤오창 쪽에 찰과상을 입은 사람이 있어 구급상자가 급히 필요합니다."
  ],
  "豆豆要去市中心找阿快办点手续，可自己的车送去保养了。": [
    "Doudou must see Akuai in Downtown to complete some paperwork, but the kart is being serviced.",
    "더우더우는 서류 처리를 위해 다운타운의 아콰이를 만나야 하지만 카트가 정비 중입니다."
  ],
  "豆豆的一袋球破了，球滚得到处都是。": [
    "Doudou's bag of balls split open, and the balls rolled everywhere.",
    "더우더우의 공 주머니가 찢어져 공이 사방으로 굴러갔습니다."
  ],
  "豆豆的眼镜掉在了小海地中部，现在什么都看不清。": [
    "Doudou lost a pair of glasses in Central Little Haiti and cannot see clearly.",
    "더우더우가 리틀 하이티 중부에서 안경을 잃어버려 잘 보이지 않습니다."
  ],
  "阿奇在针婶这里买了一只手工玻璃花瓶，一碰就碎。": [
    "Aqi bought a handmade glass vase from Aunt Zhen. A collision will shatter it.",
    "아치가 전 아주머니에게 수제 유리 꽃병을 샀습니다. 충돌하면 깨집니다."
  ],
  "罗杰的怀表修好了，里面的齿轮很精细，开太快会震坏。": [
    "Roger's pocket watch has been repaired. Its delicate gears may be damaged by driving too fast.",
    "로저의 회중시계를 수리했습니다. 빠르게 달리면 정교한 톱니바퀴가 손상될 수 있습니다."
  ],
  "阿彬抢到了一双限量款赛车鞋，在针婶这里等着取货。": [
    "Abin secured a pair of limited-edition racing shoes. They are waiting at Aunt Zhen's place.",
    "아빈가 한정판 레이싱 신발을 구했습니다. 전 아주머니의 가게에서 수령을 기다리고 있습니다."
  ],
  "针婶的车在海盗船长那里修好了，得过去取。": [
    "Aunt Zhen's kart has been repaired by Captain Lodumani and needs to be collected.",
    "전 아주머니의 카트를 로두마니 선장가 수리했습니다. 이제 찾으러 가야 합니다."
  ],
  "针婶放在几个寄卖点的货到期了，要收回来。": [
    "Aunt Zhen's consignment period has ended at several shops. Collect the remaining goods.",
    "여러 가게에 맡긴 전 아주머니의 물건이 위탁 기간을 넘겼습니다. 남은 물건을 회수하세요."
  ],
  "针婶的手机掉在了小海地南部，电量快耗光了，没电就找不到了。": [
    "Aunt Zhen dropped a phone in South Little Haiti. Find it before its battery dies and it can no longer be traced.",
    "전 아주머니가 리틀 하이티 남부에서 휴대폰을 떨어뜨렸습니다. 배터리가 꺼져 찾을 수 없게 되기 전에 찾아오세요."
  ],
  "一箱冷藏疫苗要送到安安那里，冷藏箱经不起磕碰。": [
    "Deliver refrigerated vaccines to Anan. The cooler must be protected from collisions.",
    "냉장 백신을 안안에게 배달하세요. 보냉 상자가 충돌하지 않도록 주의하세요."
  ],
  "果果那边急需一盒药品。": [
    "Guoguo urgently needs a box of medication.",
    "궈궈에게 의약품 한 상자가 급히 필요합니다."
  ],
  "椰叔的检查报告出来了，里面还有易碎的玻璃片样本，路上要稳。": [
    "Uncle Ye's test reports are ready. The package includes fragile glass slides, so drive steadily.",
    "예 아저씨의 검사 결과가 나왔습니다. 깨지기 쉬운 유리 표본도 있으니 안정적으로 운전하세요."
  ],
  "小白今晚要替阿宽值班，交接时间快到了。": [
    "Xiaobai is covering Akuan's shift tonight. The handover time is approaching.",
    "샤오바이가 오늘 밤 아콴 대신 근무합니다. 인계 시간이 다가옵니다."
  ],
  "小白这里的几种药用完了，三家药房各有一部分。": [
    "Xiaobai has run out of several medicines. Three pharmacies each have part of the order.",
    "샤오바이에게 몇 가지 약이 떨어졌습니다. 세 약국에 필요한 약이 나뉘어 있습니다."
  ],
  "小白的样本箱在路上遗失了，掉在小哈瓦那北部一带，样本得尽快送检。": [
    "Xiaobai lost a sample case near North Little Havana. Retrieve it quickly so the samples can be tested.",
    "샤오바이가 리틀 하바나 북부 근처에서 샘플 상자를 잃어버렸습니다. 빨리 찾아 검사에 보내야 합니다."
  ],
  "大勺前几天受了伤，朋友托泡泡送一束鲜花去探望。": [
    "Dashao was injured a few days ago. Friends asked Paopao to deliver a get-well bouquet.",
    "며칠 전 다샤오가 다쳤습니다. 친구들이 파오파오에게 병문안 꽃다발 배달을 부탁했습니다."
  ],
  "阿钉今晚有演出，定做的演出服刚刚做好。演出前必须送到。": [
    "Ading has a show tonight. The custom costume is ready and must arrive before the performance.",
    "아딩는 오늘 밤 공연이 있습니다. 맞춤 의상이 완성되었으니 공연 전에 전달해야 합니다."
  ],
  "有人在泡泡这里捡到一个钱包，里面的证件写着阿快的名字。": [
    "Someone left a found wallet with Paopao. The ID inside bears Akuai's name.",
    "누군가 주운 지갑을 파오파오에게 맡겼습니다. 안의 신분증에는 아콰이의 이름이 적혀 있습니다."
  ],
  "泡泡刚做好发型，要去见嘟嘟，可不想被颠乱了。": [
    "Paopao has a fresh hairstyle and is going to meet Tutu. Drive gently so it stays neat.",
    "파오파오는 새로 머리를 하고 투투를 만나러 갑니다. 머리가 흐트러지지 않도록 부드럽게 운전하세요."
  ],
  "泡泡放在几个寄卖点的货到期了，要收回来。": [
    "Paopao's consignment period has ended at several shops. Collect the remaining goods.",
    "여러 가게에 맡긴 파오파오의 물건이 위탁 기간을 넘겼습니다. 남은 물건을 회수하세요."
  ],
  "泡泡的鹦鹉飞出了笼子，有人在小哈瓦那中部听到它喊“开车啦”。": [
    "Paopao's parrot escaped its cage. Someone heard it shouting \"Let's drive!\" in Central Little Havana.",
    "파오파오의 앵무새가 새장을 탈출했습니다. 리틀 하바나 중부에서 \"출발하자!\"라는 소리가 들렸다고 합니다."
  ],
  "阿钉那边的报纸卖完了，等着新的一捆报纸。早报晚了就没人看了。": [
    "Ading sold out of newspapers and needs another bundle. Morning papers lose their readers if they arrive late.",
    "아딩의 신문이 다 팔려 새 묶음이 필요합니다. 조간신문은 늦으면 아무도 읽지 않습니다."
  ],
  "彩彩今晚办桌游之夜，借了阿宽的一套桌游。": [
    "Caicai is hosting a board game night and borrowed a game from Akuan.",
    "차이차이가 오늘 밤 보드게임 모임을 열려고 아콴에게 게임을 빌렸습니다."
  ],
  "阿光想要一只大风筝，骨架是竹子做的，一撞就散。": [
    "Aguang wants a large kite. Its bamboo frame will fall apart in a collision.",
    "아광가 큰 연을 원합니다. 대나무 뼈대는 충돌하면 부서집니다."
  ],
  "阿宽一坐车就晕，可今天非去小哈瓦那找大勺不可。": [
    "Akuan gets carsick, but must visit Dashao in Little Havana today.",
    "아콴는 차를 타면 멀미가 나지만 오늘 꼭 리틀 하바나의 다샤오를 만나야 합니다."
  ],
  "阿宽的工具借给邻居们好久了，今天要收回来。": [
    "Akuan lent tools to the neighbors a long time ago and needs them back today.",
    "아콴가 오래전에 이웃들에게 빌려준 도구를 오늘 돌려받으려고 합니다."
  ],
  "阿宽在小哈瓦那西部散步时弄丢了一串钥匙。": [
    "Akuan lost a set of keys while walking in West Little Havana.",
    "아콴가 리틀 하바나 서부에서 산책하다가 열쇠 꾸러미를 잃어버렸습니다."
  ],
  "小麦家的篱笆被风吹倒了，要一捆木板修补。": [
    "The wind knocked down Xiaomai's fence. A bundle of planks is needed for repairs.",
    "바람에 샤오마이의 울타리가 무너졌습니다. 수리할 나무판자 묶음이 필요합니다."
  ],
  "老灯的车电瓶没电了，等着备用电瓶救急。": [
    "Lao Deng's kart battery is dead. A spare battery is urgently needed.",
    "라오덩의 카트 배터리가 방전되었습니다. 예비 배터리가 급히 필요합니다."
  ],
  "大家给阿麦准备了生日惊喜，小扳得赶在阿麦回家前到场。": [
    "A surprise birthday party is ready for Amai. Xiaoban must arrive before Amai returns home.",
    "아마이를 위한 깜짝 생일 파티가 준비되었습니다. 샤오반는 아마이가 귀가하기 전에 도착해야 합니다."
  ],
  "一阵大风把小扳刚印的传单吹得满街都是。": [
    "A strong wind scattered Xiaoban's freshly printed flyers all over the streets.",
    "강풍에 샤오반가 갓 인쇄한 전단지가 거리 곳곳으로 흩어졌습니다."
  ],
  "小扳那把用了二十年的幸运扳手掉在了小哈瓦那西部。": [
    "Xiaoban lost a lucky wrench, used for twenty years, in West Little Havana.",
    "샤오반가 20년 동안 쓰던 행운의 렌치를 리틀 하바나 서부에서 잃어버렸습니다."
  ],
  "吉米那边要修东西，想借老铁的一箱维修工具。": [
    "Jimmy needs to make repairs and wants to borrow a box of tools from Lao Tie.",
    "지미가 수리를 위해 라오톄에게 공구 한 상자를 빌리고 싶어 합니다."
  ],
  "小新订的精密发动机零件到了，磕碰了就不能用。": [
    "Xiaoxin's precision engine parts have arrived. Collisions would render them unusable.",
    "샤오신가 주문한 정밀 엔진 부품이 도착했습니다. 충돌하면 사용할 수 없게 됩니다."
  ],
  "豆豆的卡丁车爆胎了，等着新轮胎才能开。": [
    "Doudou's kart has a flat tire and needs new tires before it can run again.",
    "더우더우의 카트 타이어가 터졌습니다. 다시 달리려면 새 타이어가 필요합니다."
  ],
  "老铁想去华盛顿海滩找书书买点东西。": [
    "Lao Tie wants to visit Shushu in Washington Beach to do some shopping.",
    "라오톄가 물건을 사러 워싱턴 비치의 슈슈에게 가고 싶어 합니다."
  ],
  "老铁发起了修路请愿，签名收齐后要交给葱头。": [
    "Lao Tie started a petition to repair the roads. Collect the signatures and deliver them to Ethen.",
    "라오톄가 도로 수리 청원을 시작했습니다. 서명을 모아 에띠에게 전달하세요."
  ],
  "老铁的订婚戒指掉在了市中心中部，今晚就要用。": [
    "Lao Tie dropped an engagement ring in Central Downtown and needs it tonight.",
    "라오톄가 약혼반지를 다운타운 중부에 떨어뜨렸습니다. 오늘 밤에 필요합니다."
  ],
  "罗杰的卡丁车爆胎了，等着新轮胎才能开。": [
    "Roger's kart has a flat tire and needs new tires before it can run again.",
    "로저의 카트 타이어가 터졌습니다. 다시 달리려면 새 타이어가 필요합니다."
  ],
  "小强把自己锁在门外了，备用钥匙放在大刘这里。": [
    "Xiaoqiang is locked out. The spare keys are with Da Liu.",
    "샤오창가 열쇠 없이 문을 잠가 버렸습니다. 예비 열쇠는 다류에게 있습니다."
  ],
  "小信那边要修东西，想借大刘的一箱维修工具。": [
    "Xiaoxin needs to make repairs and wants to borrow a box of tools from Da Liu.",
    "샤오신가 수리를 위해 다류에게 공구 한 상자를 빌리고 싶어 합니다."
  ],
  "大刘和老海约好了中午一起吃饭，想搭个顺风车。": [
    "Da Liu has lunch plans with Lao Hai and would like a lift.",
    "다류는 라오하이와 점심 약속이 있어 차를 얻어 타고 싶어 합니다."
  ],
  "大刘的货车车门没关好，一路掉了好几箱精密零件。": [
    "Da Liu's truck door was not closed properly. Several boxes of precision parts fell out along the road.",
    "다류의 트럭 문이 제대로 닫히지 않아 정밀 부품 상자 여러 개가 길에 떨어졌습니다."
  ],
  "大刘那把用了二十年的幸运扳手掉在了小哈瓦那北部。": [
    "Da Liu lost a lucky wrench, used for twenty years, in North Little Havana.",
    "다류가 20년 동안 쓰던 행운의 렌치를 리틀 하바나 북부에서 잃어버렸습니다."
  ],
  "大海的怀表修好了，里面的齿轮很精细，开太快会震坏。": [
    "Dahai's pocket watch has been repaired. Its delicate gears may be damaged by driving too fast.",
    "다하이의 회중시계를 수리했습니다. 빠르게 달리면 정교한 톱니바퀴가 손상될 수 있습니다."
  ],
  "彩彩旅行回来，给星星带了一盒纪念品。": [
    "Caicai returned from a trip with a box of souvenirs for Xingxing.",
    "여행에서 돌아온 차이차이가 싱싱에게 줄 기념품 한 상자를 가져왔습니다."
  ],
  "莎莎新家要一面落地镜，镜子又大又脆。": [
    "Shasha needs a full-length mirror for a new home. It is large and fragile.",
    "샤샤의 새집에 전신 거울이 필요합니다. 크고 깨지기 쉬운 물건입니다."
  ],
  "彩彩要去市中心找卡米拉办点手续，可自己的车送去保养了。": [
    "Caicai must see Camilla in Downtown to complete some paperwork, but the kart is being serviced.",
    "차이차이는 서류 처리를 위해 다운타운의 카밀라를 만나야 하지만 카트가 정비 중입니다."
  ],
  "节日过去了，彩彩挂在街上的纸灯笼要收回来，纸灯笼一撞就破。": [
    "The festival is over. Collect Caicai's paper lanterns from the streets and avoid collisions; they tear easily.",
    "축제가 끝났습니다. 차이차이가 거리에 걸어 둔 종이 등불을 회수하세요. 쉽게 찢어지니 충돌을 피하세요."
  ],
  "彩彩的钱包不知什么时候掉在了小海地西部。": [
    "Caicai lost a wallet somewhere in West Little Haiti.",
    "차이차이가 리틀 하이티 서부 어딘가에서 지갑을 잃어버렸습니다."
  ],
  "晴晴在阿钉这里买了一只手工玻璃花瓶，一碰就碎。": [
    "Qingqing bought a handmade glass vase from Ading. A collision will shatter it.",
    "칭칭가 아딩에게 수제 유리 꽃병을 샀습니다. 충돌하면 깨집니다."
  ],
  "雯雯的店要换新招牌，霓虹灯管一碰就碎。": [
    "Wenwen's shop needs a new sign. The neon tubes break easily in a collision.",
    "원원의 가게에 새 간판이 필요합니다. 네온관은 충돌하면 쉽게 깨집니다."
  ],
  "阿丰领养了阿钉家的金鱼，鱼缸里的水满满的。": [
    "Afeng adopted Ading's goldfish. The tank is filled to the brim.",
    "아펑가 아딩의 금붕어를 입양했습니다. 어항에 물이 가득 차 있습니다."
  ],
  "阿钉睡过了头，要赶去华盛顿海滩找小乖，再不快点就迟到了。": [
    "Ading overslept and must hurry to meet Uni in Washington Beach. There is little time left.",
    "아딩가 늦잠을 잤습니다. 늦지 않으려면 워싱턴 비치에 있는 우니에게 서둘러 가야 합니다."
  ],
  "阿钉放在几个寄卖点的货到期了，要收回来。": [
    "Ading's consignment period has ended at several shops. Collect the remaining goods.",
    "여러 가게에 맡긴 아딩의 물건이 위탁 기간을 넘겼습니다. 남은 물건을 회수하세요."
  ],
  "阿钉把外婆送的雨伞落在了小哈瓦那北部。": [
    "Ading left a grandmother's gift umbrella in North Little Havana.",
    "아딩가 할머니께 선물 받은 우산을 리틀 하바나 북부에 두고 왔습니다."
  ],
  "宝宝家的篱笆被风吹倒了，要一捆木板修补。": [
    "The wind knocked down Bazzi's fence. A bundle of planks is needed for repairs.",
    "바람에 배찌의 울타리가 무너졌습니다. 수리할 나무판자 묶음이 필요합니다."
  ],
  "上次下雨，水水借了老周一把伞，一直没机会还。": [
    "Shuishui borrowed an umbrella from Lao Zhou when it rained and has not had a chance to return it.",
    "슈이슈이는 비가 오던 날 라오저우에게 우산을 빌렸지만 아직 돌려주지 못했습니다."
  ],
  "米粒订的精密发动机零件到了，磕碰了就不能用。": [
    "Mili's precision engine parts have arrived. Collisions would render them unusable.",
    "미리가 주문한 정밀 엔진 부품이 도착했습니다. 충돌하면 사용할 수 없게 됩니다."
  ],
  "水水要去海洋海滩看皮蛋的演出，眼看就要开场了。": [
    "Shuishui is going to see Dao's show in Ocean Beach. The performance starts soon.",
    "슈이슈이는 오션 비치에서 다오의 공연을 보려고 합니다. 곧 공연이 시작됩니다."
  ],
  "一阵大风把水水刚印的传单吹得满街都是。": [
    "A strong wind scattered Shuishui's freshly printed flyers all over the streets.",
    "강풍에 슈이슈이가 갓 인쇄한 전단지가 거리 곳곳으로 흩어졌습니다."
  ],
  "水水的猫从窗户溜了出去，最后有人在小哈瓦那中部看到它。": [
    "Shuishui's cat slipped out the window and was last seen in Central Little Havana.",
    "슈이슈이의 고양이가 창문으로 빠져나갔습니다. 마지막으로 목격된 곳은 리틀 하바나 중부입니다."
  ],
  "小剪那边急需一盒药品。": [
    "Xiaojian urgently needs a box of medication.",
    "샤오젠에게 의약품 한 상자가 급히 필요합니다."
  ],
  "蓝蓝的检查报告出来了，里面还有易碎的玻璃片样本，路上要稳。": [
    "Lanlan's test reports are ready. The package includes fragile glass slides, so drive steadily.",
    "란란의 검사 결과가 나왔습니다. 깨지기 쉬운 유리 표본도 있으니 안정적으로 운전하세요."
  ],
  "小雪今晚要替胖墩值班，交接时间快到了。": [
    "Xiaoxue is covering Kephi's shift tonight. The handover time is approaching.",
    "샤오쉐가 오늘 밤 케피 대신 근무합니다. 인계 시간이 다가옵니다."
  ],
  "小雪这里的几种药用完了，三家药房各有一部分。": [
    "Xiaoxue has run out of several medicines. Three pharmacies each have part of the order.",
    "샤오쉐에게 몇 가지 약이 떨어졌습니다. 세 약국에 필요한 약이 나뉘어 있습니다."
  ],
  "小雪的样本箱在路上遗失了，掉在市中心中部一带，样本得尽快送检。": [
    "Xiaoxue lost a sample case near Central Downtown. Retrieve it quickly so the samples can be tested.",
    "샤오쉐가 다운타운 중부 근처에서 샘플 상자를 잃어버렸습니다. 빨리 찾아 검사에 보내야 합니다."
  ],
  "一箱冷藏疫苗要送到老铁那里，冷藏箱经不起磕碰。": [
    "Deliver refrigerated vaccines to Lao Tie. The cooler must be protected from collisions.",
    "냉장 백신을 라오톄에게 배달하세요. 보냉 상자가 충돌하지 않도록 주의하세요."
  ],
  "海盗船长那边急需一盒药品。": [
    "Captain Lodumani urgently needs a box of medication.",
    "로두마니 선장에게 의약품 한 상자가 급히 필요합니다."
  ],
  "大壮的检查报告出来了，里面还有易碎的玻璃片样本，路上要稳。": [
    "Dazhuang's test reports are ready. The package includes fragile glass slides, so drive steadily.",
    "다좡의 검사 결과가 나왔습니다. 깨지기 쉬운 유리 표본도 있으니 안정적으로 운전하세요."
  ],
  "白大夫今晚要替大刘值班，交接时间快到了。": [
    "Dr. Bai is covering Da Liu's shift tonight. The handover time is approaching.",
    "바이 선생님가 오늘 밤 다류 대신 근무합니다. 인계 시간이 다가옵니다."
  ],
  "白大夫这里的几种药用完了，三家药房各有一部分。": [
    "Dr. Bai has run out of several medicines. Three pharmacies each have part of the order.",
    "바이 선생님에게 몇 가지 약이 떨어졌습니다. 세 약국에 필요한 약이 나뉘어 있습니다."
  ],
  "白大夫的样本箱在路上遗失了，掉在小海地北部一带，样本得尽快送检。": [
    "Dr. Bai lost a sample case near North Little Haiti. Retrieve it quickly so the samples can be tested.",
    "바이 선생님가 리틀 하이티 북부 근처에서 샘플 상자를 잃어버렸습니다. 빨리 찾아 검사에 보내야 합니다."
  ],
  "一袋机密文件要亲手交给美玲。": [
    "A bag of confidential documents must be handed directly to Meiling.",
    "기밀 서류 한 봉지를 메이링에게 직접 전달해야 합니다."
  ],
  "金金要办派对，请柬要送到甜甜那里帮忙分发。": [
    "Jinjin is hosting a party. Take the invitations to Tiantian for distribution.",
    "진진가 파티를 엽니다. 초대장을 나눠 줄 수 있도록 톈톈에게 전달하세요."
  ],
  "一个写着“加急”的包裹要送到针婶那里。": [
    "A parcel marked \"Urgent\" must be delivered to Aunt Zhen.",
    "\"긴급\"이라고 적힌 소포를 전 아주머니에게 전달해야 합니다."
  ],
  "金金想顺路看看卡丁城的风景，再去小海地找小扳。": [
    "Jinjin wants to enjoy Kart City's scenery on the way to see Xiaoban in Little Haiti.",
    "진진는 카트 시티의 경치를 구경하며 리틀 하이티의 샤오반에게 가고 싶어 합니다."
  ],
  "社区要办义卖，金金联系了几位捐赠人，东西收齐后交给阿虎。": [
    "For the community charity sale, Jinjin contacted several donors. Collect their donations and take them to Ahu.",
    "마을 자선 바자회를 위해 진진가 기부자들에게 연락했습니다. 물품을 모아 아후에게 전달하세요."
  ],
  "金金的工作证掉在了市中心北部，没有它就进不了门。": [
    "Jinjin lost an employee ID in North Downtown and cannot enter the workplace without it.",
    "진진가 다운타운 북부에서 사원증을 잃어버렸습니다. 사원증 없이는 직장에 들어갈 수 없습니다."
  ],
  "糖糖要的施工图纸画好了。": [
    "The construction plans requested by Tangtang are ready.",
    "탕탕가 요청한 공사 도면이 완성되었습니다."
  ],
  "福尔摩斯写了一封感谢信给果果，感谢上次的帮忙。": [
    "Holmes wrote Guoguo a letter of thanks for helping last time.",
    "홈즈가 지난번 도움에 감사하며 궈궈에게 편지를 썼습니다."
  ],
  "黑妞那边等着签合同，下班前必须送到。": [
    "Dizni is waiting to sign a contract. Deliver it before the end of the workday.",
    "디지니가 계약서에 서명하려고 기다립니다. 퇴근 시간 전에 전달해야 합니다."
  ],
  "福尔摩斯这几天身体不舒服，约了药店店员小白复诊。坐车颠了会头晕。": [
    "Holmes has been unwell and has a follow-up appointment with pharmacy clerk Xiaobai. Bumpy driving causes dizziness.",
    "홈즈는 몸이 좋지 않아 약국 직원 샤오바이와 다시 상담하기로 했습니다. 차가 흔들리면 어지러워합니다."
  ],
  "福尔摩斯发起了修路请愿，签名收齐后要交给跳跳。": [
    "Holmes started a petition to repair the roads. Collect the signatures and deliver them to Tiaotiao.",
    "홈즈가 도로 수리 청원을 시작했습니다. 서명을 모아 탸오탸오에게 전달하세요."
  ],
  "福尔摩斯的货车颠了一下，一个包裹掉在了罪恶角中部，客户等着要。": [
    "A bump knocked a parcel from Holmes's truck in Central Vice Point. The customer is waiting for it.",
    "홈즈의 트럭이 흔들리면서 소포 하나가 바이스 포인트 중부에 떨어졌습니다. 손님이 기다리고 있습니다."
  ],
  "阿浪预约的书到了，一大摞。": [
    "A large stack of books reserved by Alang has arrived.",
    "아랑가 예약한 책이 한가득 도착했습니다."
  ],
  "社区投票结束了，投票箱要交给阿香统计。投票箱要稳稳地送，路上不能出差错。": [
    "Community voting has ended. Take the ballot box safely to Axiang for counting; nothing must go wrong en route.",
    "마을 투표가 끝났습니다. 개표를 위해 투표함을 아샹에게 안전하게 전달하세요. 이동 중 문제가 생기면 안 됩니다."
  ],
  "阿豆那边等着签合同，下班前必须送到。": [
    "Adou is waiting to sign a contract. Deliver it before the end of the workday.",
    "아더우가 계약서에 서명하려고 기다립니다. 퇴근 시간 전에 전달해야 합니다."
  ],
  "罗杰约了水水做一次采访，时间快到了。": [
    "Roger has arranged an interview with Shuishui. The appointment is soon.",
    "로저는 슈이슈이와 인터뷰 약속을 잡았습니다. 약속 시간이 다가옵니다."
  ],
  "附近几个邮筒都满了，罗杰请人帮忙把信收回来。": [
    "Nearby mailboxes are full. Roger needs help collecting the letters.",
    "근처 우체통이 가득 찼습니다. 로저가 편지 수거를 도와 달라고 합니다."
  ],
  "罗杰的工作证掉在了市中心北部，没有它就进不了门。": [
    "Roger lost an employee ID in North Downtown and cannot enter the workplace without it.",
    "로저가 다운타운 북부에서 사원증을 잃어버렸습니다. 사원증 없이는 직장에 들어갈 수 없습니다."
  ],
  "一袋机密文件要亲手交给阿奇。": [
    "A bag of confidential documents must be handed directly to Aqi.",
    "기밀 서류 한 봉지를 아치에게 직접 전달해야 합니다."
  ],
  "卡米拉分了一盆多肉植物给神秘工头，花盆是陶瓷的。": [
    "Camilla is giving Mysterious Foreman a succulent in a ceramic pot.",
    "카밀라가 수수께끼의 반장에게 다육식물을 나눠 줍니다. 화분은 도자기입니다."
  ],
  "大力那边有人擦伤了，急需一个急救包。": [
    "Someone near Dali has a scrape and urgently needs a first-aid kit.",
    "다리 쪽에 찰과상을 입은 사람이 있어 구급상자가 급히 필요합니다."
  ],
  "卡米拉这几天身体不舒服，约了药店店员小白复诊。坐车颠了会头晕。": [
    "Camilla has been unwell and has a follow-up appointment with pharmacy clerk Xiaobai. Bumpy driving causes dizziness.",
    "카밀라는 몸이 좋지 않아 약국 직원 샤오바이와 다시 상담하기로 했습니다. 차가 흔들리면 어지러워합니다."
  ],
  "活动结束了，卡米拉贴在街上的海报要赶在检查前撤下来。": [
    "The event is over. Remove Camilla's street posters before the inspection.",
    "행사가 끝났습니다. 점검 전에 카밀라가 거리에 붙인 포스터를 떼어 내세요."
  ],
  "卡米拉的工作证掉在了罪恶角中部，没有它就进不了门。": [
    "Camilla lost an employee ID in Central Vice Point and cannot enter the workplace without it.",
    "카밀라가 바이스 포인트 중부에서 사원증을 잃어버렸습니다. 사원증 없이는 직장에 들어갈 수 없습니다."
  ],
  "社区投票结束了，投票箱要交给阿彬统计。投票箱要稳稳地送，路上不能出差错。": [
    "Community voting has ended. Take the ballot box safely to Abin for counting; nothing must go wrong en route.",
    "마을 투표가 끝났습니다. 개표를 위해 투표함을 아빈에게 안전하게 전달하세요. 이동 중 문제가 생기면 안 됩니다."
  ],
  "小美今晚办桌游之夜，借了阿快的一套桌游。": [
    "Xiaomei is hosting a board game night and borrowed a game from Akuai.",
    "샤오메이가 오늘 밤 보드게임 모임을 열려고 아콰이에게 게임을 빌렸습니다."
  ],
  "福尔摩斯要的施工图纸画好了。": [
    "The construction plans requested by Holmes are ready.",
    "홈즈가 요청한 공사 도면이 완성되었습니다."
  ],
  "阿快想顺路看看卡丁城的风景，再去罪恶角找王伯。": [
    "Akuai wants to enjoy Kart City's scenery on the way to see Uncle Wang in Vice Point.",
    "아콰이는 카트 시티의 경치를 구경하며 바이스 포인트의 왕 아저씨에게 가고 싶어 합니다."
  ],
  "节日过去了，阿快挂在街上的纸灯笼要收回来，纸灯笼一撞就破。": [
    "The festival is over. Collect Akuai's paper lanterns from the streets and avoid collisions; they tear easily.",
    "축제가 끝났습니다. 아콰이가 거리에 걸어 둔 종이 등불을 회수하세요. 쉽게 찢어지니 충돌을 피하세요."
  ],
  "阿快的眼镜掉在了市中心东部，现在什么都看不清。": [
    "Akuai lost a pair of glasses in East Downtown and cannot see clearly.",
    "아콰이가 다운타운 동부에서 안경을 잃어버려 잘 보이지 않습니다."
  ],
  "金金的旅行照片冲洗好了，装成了一本相册。": [
    "Jinjin's travel photos have been developed and made into an album.",
    "진진의 여행 사진을 인화해 앨범으로 만들었습니다."
  ],
  "小雪给侄子买了一辆遥控卡丁车玩具当礼物。": [
    "Xiaoxue bought a remote-control kart toy as a gift for a nephew.",
    "샤오쉐가 조카에게 선물할 무선 조종 카트 장난감을 샀습니다."
  ],
  "今晚的演唱会快开始了，白大夫的门票还在星星这里。": [
    "Tonight's concert is about to start, but Dr. Bai's ticket is still with Xingxing.",
    "오늘 밤 공연이 곧 시작되는데 바이 선생님의 표는 아직 싱싱에게 있습니다."
  ],
  "星星要把一幅刚画好的画送给美玲，画框又大又脆。": [
    "Xingxing wants to give Meiling a freshly finished painting. Its frame is large and fragile.",
    "싱싱가 막 완성한 그림을 메이링에게 주려고 합니다. 액자가 크고 약합니다."
  ],
  "星星在做一本卡丁城画册，还差三张取景照片。": [
    "Xingxing is making a Kart City photo book and needs three more location photos.",
    "싱싱가 카트 시티 사진집을 만들고 있습니다. 촬영지 사진이 세 장 더 필요합니다."
  ],
  "星星一脚把签名足球踢飞了，球落在了华盛顿海滩南部。": [
    "Xingxing kicked an autographed football too hard. It landed in South Washington Beach.",
    "싱싱가 사인받은 축구공을 너무 세게 차서 워싱턴 비치 남부까지 날아갔습니다."
  ],
  "老铁要做早餐蛋饼，在阿丰这里买了一托新鲜鸡蛋。鸡蛋一撞就碎。": [
    "Lao Tie bought a tray of fresh eggs from Afeng for breakfast pancakes. A collision will break them.",
    "라오톄가 아침 달걀 부침을 만들려고 아펑에게 신선한 달걀 한 판을 샀습니다. 충돌하면 깨집니다."
  ],
  "糖糖晚上要开派对，零食全在阿丰这里订好了。": [
    "Tangtang is throwing a party tonight and has ordered all the snacks from Afeng.",
    "탕탕가 오늘 밤 파티를 열려고 간식을 모두 아펑에게 주문했습니다."
  ],
  "米粒的咖啡豆快用完了，阿丰这里刚烘好一批。": [
    "Mili is running out of coffee beans. Afeng has just roasted a fresh batch.",
    "미리의 커피 원두가 떨어져 갑니다. 아펑에게 갓 볶은 원두가 있습니다."
  ],
  "阿丰的店里缺货了，要去阿浪那里进一批货。": [
    "Afeng's shop is running low on stock and needs supplies from Alang.",
    "아펑의 가게에 물건이 부족해 아랑에게서 새 물품을 가져와야 합니다."
  ],
  "饭点快到了，阿丰还缺几样食材，三家店分在不同的街上。": [
    "Mealtime is approaching and Afeng still needs ingredients from three shops on different streets.",
    "식사 시간이 다가오는데 아펑에게 식재료가 부족합니다. 서로 다른 거리에 있는 세 가게에서 가져오세요."
  ],
  "阿丰的一只鸡从笼子里跑了出去，在小哈瓦那西部到处乱窜。": [
    "One of Afeng's chickens escaped its cage and is running around West Little Havana.",
    "아펑의 닭 한 마리가 우리에서 탈출해 리틀 하바나 서부 곳곳을 돌아다니고 있습니다."
  ],
  "大壮那边的报纸卖完了，等着新的一捆报纸。早报晚了就没人看了。": [
    "Dazhuang sold out of newspapers and needs another bundle. Morning papers lose their readers if they arrive late.",
    "다좡의 신문이 다 팔려 새 묶음이 필요합니다. 조간신문은 늦으면 아무도 읽지 않습니다."
  ],
  "有人在小信这里捡到一个钱包，里面的证件写着葱头的名字。": [
    "Someone left a found wallet with Xiaoxin. The ID inside bears Ethen's name.",
    "누군가 주운 지갑을 샤오신에게 맡겼습니다. 안의 신분증에는 에띠의 이름이 적혀 있습니다."
  ],
  "小扳把自己锁在门外了，备用钥匙放在小信这里。": [
    "Xiaoban is locked out. The spare keys are with Xiaoxin.",
    "샤오반가 열쇠 없이 문을 잠가 버렸습니다. 예비 열쇠는 샤오신에게 있습니다."
  ],
  "小信的车在胖墩那里修好了，得过去取。": [
    "Xiaoxin's kart has been repaired by Kephi and needs to be collected.",
    "샤오신의 카트를 케피가 수리했습니다. 이제 찾으러 가야 합니다."
  ],
  "社区要办义卖，小信联系了几位捐赠人，东西收齐后交给安安。": [
    "For the community charity sale, Xiaoxin contacted several donors. Collect their donations and take them to Anan.",
    "마을 자선 바자회를 위해 샤오신가 기부자들에게 연락했습니다. 물품을 모아 안안에게 전달하세요."
  ],
  "小信在小哈瓦那北部散步时弄丢了一串钥匙。": [
    "Xiaoxin lost a set of keys while walking in North Little Havana.",
    "샤오신가 리틀 하바나 북부에서 산책하다가 열쇠 꾸러미를 잃어버렸습니다."
  ]
};

export function cityContentName(source: string): string {
  const locale = gameLocale();
  return locale === "zh-CN" ? source : cityContentNames[source]?.[locale === "ko" ? 1 : 0] ?? source;
}
