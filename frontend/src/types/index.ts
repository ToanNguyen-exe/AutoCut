export interface WordInfo {
  word: string;
  start: number;
  end: number;
}

export interface Sentence {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: WordInfo[];
}

export interface TranscriptData {
  video: string;
  duration: number;
  sentences: Sentence[];
}

export interface VideoPart {
  part: number;
  start: number;
  end: number;
  file: string;
}

export interface Segment {
  id: string;
  section_no: number;
  section: string;
  topic_no: number;
  topic: string;
  slug: string;
  start_id: string;
  end_id: string;
  start: number;
  end: number;
  parts: VideoPart[];
}

export interface SegmentsData {
  video: string;
  lesson: string;
  mode: string;
  reviewed: boolean;
  segments: Segment[];
}
