// How many SMS a text is billed as. Plain text (the GSM 03.38 alphabet) fits 160 characters in one message and
// 153 per part once split; anything else (emoji, most accented letters, other scripts) is sent as UCS-2: 70, then
// 67 per part. The extension characters (^{}\[~]|€ and form feed) take two of the 160.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENSION = "^{}\\[~]|€\f";

export const SMS_MAX_SEGMENTS = 3;

export function smsSegments(text: string): number {
  let gsmUnits = 0;
  for (const char of text) {
    if (GSM_BASIC.includes(char)) {
      gsmUnits += 1;
    } else if (GSM_EXTENSION.includes(char)) {
      gsmUnits += 2;
    } else {
      // UCS-2 counts UTF-16 code units, so an emoji takes two.
      return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
    }
  }
  return gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153);
}
