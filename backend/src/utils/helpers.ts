import natural from 'natural';
// @ts-ignore
import STOP_WORDS from '../../../.data/stop_words.json';

export const sanitizeText = (text: string): string => {
  text = text.toLowerCase().trim();
  // Keep letters (\p{L}), numbers (\p{N}), and spaces (\s)
  text = text.replace(/[^\p{L}\p{N}\s]/gu, '');

  return text;
};

export const tokenizeText = (text: string): string[] => {
  return text
    .split(/\s+/)
    .filter((token) => !STOP_WORDS.includes(token))
    .map((token) => natural.PorterStemmer.stem(token))
    .filter(Boolean);
};

export const cleanDescription = (description: string): string => {
  // Strip template sections (prerequisites, environment) - keep core bug description
  const coreDescription = description
    ?.split(/(?=^#{1,4}\s)/m)
    .filter(
      (section: string) =>
        !/^#{1,4}\s+(?:Pre-?requisites?|Environment|Steps to reproduce)/i.test(
          section.trim(),
        ),
    )
    .join('');

  // Clean description
  const cleanedDescription = coreDescription
    ?.replaceAll(/!\[(.*?)\]\((.*?)\)/g, (_: unknown, alt: string) => {
      if (
        !alt ||
        /^(image|img|figure|fig|photo|pic|screenshot)[\s-_]*\d*$/i.test(
          alt.trim().toLowerCase(),
        )
      ) {
        // Remove generic image entirely
        return '[image]';
      }

      // Replace non-generic image with alt text
      return `[${alt}]`;
    })
    // Collapse multiple spaces/newlines into a single space
    .replaceAll(/\s+/g, ' ')
    .trim();

  return cleanedDescription;
};
