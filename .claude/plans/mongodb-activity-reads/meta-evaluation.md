# 메타 검토 — Gibbs

조건부 PASS. private JS부분검색/공개route SQLLIKE/원문HMAC users구분 및8초총기한·scan별fullrow32MiB20k shadow추가제약수락.

V2필수보완: (1) transaction종료후반환직전deadline확인,마지막page/formatter/commit지연초과반환금지·벽시계8초보장제외. (2) LIKE %/_/역슬래시조합·개행·비BMP를실PG대조,private literal대조군;UTF16단일문자로SQL글자대체금지. (3) fetchedAt은feedtransaction내부·usage transaction후route원래위치유지. (4) scan별한도는메서드총메모리상한아님,전체8초공유·한분기실패전체실패;Mongo동일transaction내명령병렬금지.

실제BSONshort/다중batch/snapshot경합필수,모든대형경계실데이터/실8초대기는불필요. 계측주입·가상시간/미실행분리유지.
