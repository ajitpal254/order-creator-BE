// Utility to convert numbers into Words (Indian Currency & International Currency)

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function convertLessThanThousand(n) {
  let str = '';
  if (n >= 100) {
    str += ones[Math.floor(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n >= 20) {
    str += tens[Math.floor(n / 10)] + ' ';
    n %= 10;
  }
  if (n > 0) {
    str += ones[n] + ' ';
  }
  return str.trim();
}

/**
 * Indian Numbering Format: Crores, Lakhs, Thousands, Hundreds
 * Example: 5242310 -> "Rs. Fifty Two Lakh Forty Two Thousand Three Hundred Ten Only"
 */
export function numberToWordsIndian(num) {
  if (num === 0 || isNaN(num)) return 'Rs. Zero Only';
  
  const absoluteNum = Math.abs(num);
  const rupees = Math.floor(absoluteNum);
  const paise = Math.round((absoluteNum - rupees) * 100);

  const crore = Math.floor(rupees / 10000000);
  let remainder = rupees % 10000000;
  const lakh = Math.floor(remainder / 100000);
  remainder = remainder % 100000;
  const thousand = Math.floor(remainder / 1000);
  remainder = remainder % 1000;
  const hundred = remainder;

  let words = '';
  if (crore > 0) {
    words += convertLessThanThousand(crore) + ' Crore ';
  }
  if (lakh > 0) {
    words += convertLessThanThousand(lakh) + ' Lakh ';
  }
  if (thousand > 0) {
    words += convertLessThanThousand(thousand) + ' Thousand ';
  }
  if (hundred > 0) {
    words += convertLessThanThousand(hundred) + ' ';
  }

  words = words.trim();
  if (!words) words = 'Zero';

  let result = 'Rs. ' + words;
  if (paise > 0) {
    result += ' and ' + convertLessThanThousand(paise) + ' Paise';
  }
  result += ' Only';
  return result;
}

/**
 * International Format (US Dollars & Cents / Currency Units)
 * Example: 29483.97 -> "TOTAL US$: TWENTY NINE THOUSAND FOUR HUNDRED EIGHTY THREE AND CENTS 97 ONLY"
 */
export function numberToWordsInternational(num, currencyPrefix = 'TOTAL US$: ') {
  if (num === 0 || isNaN(num)) return (currencyPrefix + 'ZERO ONLY').toUpperCase();

  const absoluteNum = Math.abs(num);
  const mainVal = Math.floor(absoluteNum);
  const cents = Math.round((absoluteNum - mainVal) * 100);

  const billion = Math.floor(mainVal / 1000000000);
  let remainder = mainVal % 1000000000;
  const million = Math.floor(remainder / 1000000);
  remainder = remainder % 1000000;
  const thousand = Math.floor(remainder / 1000);
  remainder = remainder % 1000;
  const units = remainder;

  let words = '';
  if (billion > 0) {
    words += convertLessThanThousand(billion) + ' Billion ';
  }
  if (million > 0) {
    words += convertLessThanThousand(million) + ' Million ';
  }
  if (thousand > 0) {
    words += convertLessThanThousand(thousand) + ' Thousand ';
  }
  if (units > 0) {
    words += convertLessThanThousand(units) + ' ';
  }

  words = words.trim();
  if (!words) words = 'Zero';

  let res = currencyPrefix + words;
  if (cents > 0) {
    res += ' AND CENTS ' + cents;
  }
  res += ' ONLY';
  return res.toUpperCase();
}
