// 위키 공용 배지(아바타). 실제 로고/사진 대신 이름 이니셜 + 결정적 고유색 네모박스.
// 기업위키·강사위키가 같은 배지를 쓰도록 공용화한다. 서버·클라이언트 컴포넌트 양쪽에서 사용 가능.

export function avatarMonogram(name: string): string {
  const trimmed = name.trim();
  const ascii = trimmed.match(/^[A-Za-z]+/);
  if (ascii) return ascii[0].slice(0, 2).toUpperCase();
  return trimmed.slice(0, 1);
}

export function avatarColor(name: string): string {
  let hue = 0;
  for (let index = 0; index < name.length; index += 1) hue = (hue * 31 + name.charCodeAt(index)) % 360;
  return `hsl(${hue}, 52%, 45%)`;
}

export function WikiAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`wiki-logo wiki-logo-${size}`} style={{ background: avatarColor(name) }}>
      {avatarMonogram(name)}
    </span>
  );
}
