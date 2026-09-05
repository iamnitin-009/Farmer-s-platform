// src/utils/quality.js
// Deterministic Produce Quality Grading Engine for SIH 2026

export const GRADE_THRESHOLDS = {
  GRADE_A_MIN: 90,
  GRADE_B_MIN: 75,
}

/**
 * Deterministically calculates Grade A, B, or C based on quality score (0-100).
 * 90 - 100 => Grade A
 * 75 - 89  => Grade B
 * 0 - 74   => Grade C
 *
 * @param {number|null} score
 * @returns {'A'|'B'|'C'|null}
 */
export function calculateGrade(score) {
  if (typeof score !== 'number' || isNaN(score)) return null
  if (score >= GRADE_THRESHOLDS.GRADE_A_MIN) return 'A'
  if (score >= GRADE_THRESHOLDS.GRADE_B_MIN) return 'B'
  return 'C'
}

/**
 * Validates if score is within acceptable 0-100 range.
 * @param {any} score
 * @returns {boolean}
 */
export function isValidQualityScore(score) {
  return typeof score === 'number' && !isNaN(score) && score >= 0 && score <= 100
}

/**
 * Returns consistent visual badge styling for Grade badges.
 * @param {'A'|'B'|'C'|string} grade
 * @returns {{ background: string, color: string, border: string }}
 */
export function getGradeBadgeStyle(grade) {
  switch (grade) {
    case 'A':
      return {
        bg: 'rgba(62, 107, 46, 0.12)',
        background: 'rgba(62, 107, 46, 0.12)',
        color: '#2e6b2e',
        border: 'rgba(62, 107, 46, 0.35)',
      }
    case 'B':
      return {
        bg: 'rgba(200, 150, 62, 0.14)',
        background: 'rgba(200, 150, 62, 0.14)',
        color: '#9a6b18',
        border: 'rgba(200, 150, 62, 0.4)',
      }
    case 'C':
      return {
        bg: 'rgba(120, 113, 108, 0.14)',
        background: 'rgba(120, 113, 108, 0.14)',
        color: '#57534e',
        border: 'rgba(120, 113, 108, 0.35)',
      }
    default:
      return {
        bg: 'rgba(100, 116, 139, 0.1)',
        background: 'rgba(100, 116, 139, 0.1)',
        color: '#64748b',
        border: 'rgba(100, 116, 139, 0.25)',
      }
  }
}
