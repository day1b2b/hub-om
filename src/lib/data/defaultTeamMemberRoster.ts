import type { ResourceOwnerRoster, TeamMemberRoleRoster } from "./teamMemberRepository";

export const DEFAULT_RESOURCE_OWNER_ROSTER: Required<Pick<ResourceOwnerRoster, "1팀" | "2팀">> = {
  "1팀": ["공새봄", "강지선", "김동찬", "김솔이", "김별", "서정연", "이은서", "이주연", "정태윤", "정하영", "하승민"],
  "2팀": [
    "강연정",
    "강진우",
    "권노을",
    "김민선",
    "김윤지",
    "방신우",
    "손승완",
    "손지훈",
    "송승희",
    "이수빈",
    "이현진",
    "정다혜",
    "정선희",
    "홍예진"
  ]
};

export const DEFAULT_TEAM_MEMBER_ROLE_ROSTER: TeamMemberRoleRoster = {
  ld: {},
  om: {
    "1팀": [
      "김민진",
      "김재현",
      "김정선",
      "김지혜B",
      "두소진",
      "박현서",
      "안유진B",
      "엄찬익",
      "윤정아",
      "이수빈B",
      "이유영B",
      "이주은",
      "이현정",
      "임지민",
      "정수아",
      "조여경",
      "최정연",
      "최지현B",
      "홍정이"
    ],
    "2팀": [
      "김세린",
      "김연수",
      "김오틸리아",
      "박규은",
      "백희영",
      "안서연",
      "오수연",
      "윤성민",
      "이유진C",
      "이혜림",
      "조경수"
    ]
  }
};
