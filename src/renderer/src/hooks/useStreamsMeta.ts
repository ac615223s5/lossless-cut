import { useCallback, useMemo, useState } from 'react';
import pMap from 'p-map';
import invariant from 'tiny-invariant';

import { isStreamThumbnail, shouldCopyStreamByDefault } from '../util/streams';
import StreamsSelector from '../StreamsSelector';
import { FFprobeStream } from '../../../../ffprobe';
import { FilesMeta } from '../types';
import safeishEval from '../worker/eval';
import i18n from '../i18n';
import { filterEnabledStreamsDialog } from '../dialogs';


export default ({ mainStreams, externalFilesMeta, filePath, autoExportExtraStreams }: {
  mainStreams: FFprobeStream[],
  externalFilesMeta: FilesMeta,
  filePath: string | undefined,
  autoExportExtraStreams: boolean,
}) => {
  const [copyStreamIdsByFile, setCopyStreamIdsByFile] = useState<Record<string, Record<string, boolean>>>({});
  // this will be remembered between files:
  const [enabledStreamsFilter, setEnabledStreamsFilter] = useState<string>();

  const isCopyingStreamId = useCallback((path: string | undefined, streamId: number) => (
    !!((path != null && copyStreamIdsByFile[path]) || {})[streamId]
  ), [copyStreamIdsByFile]);

  const mainCopiedStreams = useMemo(() => mainStreams.filter((stream) => isCopyingStreamId(filePath, stream.index)), [filePath, isCopyingStreamId, mainStreams]);
  const mainCopiedThumbnailStreams = useMemo(() => mainCopiedStreams.filter((stream) => isStreamThumbnail(stream)), [mainCopiedStreams]);

  // Streams that are not copy enabled by default
  const extraStreams = useMemo(() => mainStreams.filter((stream) => !shouldCopyStreamByDefault(stream)), [mainStreams]);

  // Extra streams that the user has not selected for copy
  const nonCopiedExtraStreams = useMemo(() => extraStreams.filter((stream) => !isCopyingStreamId(filePath, stream.index)), [extraStreams, filePath, isCopyingStreamId]);

  const exportExtraStreams = autoExportExtraStreams && nonCopiedExtraStreams.length > 0;

  const copyFileStreams = useMemo(() => Object.entries(copyStreamIdsByFile).map(([path, streamIdsMap]) => ({
    path,
    streamIds: Object.entries(streamIdsMap).filter(([, shouldCopy]) => shouldCopy).map(([streamIdStr]) => parseInt(streamIdStr, 10)),
  })), [copyStreamIdsByFile]);

  // total number of streams to copy for ALL files
  const numStreamsToCopy = useMemo(() => copyFileStreams.reduce((acc, { streamIds }) => acc + streamIds.length, 0), [copyFileStreams]);

  const setCopyStreamIdsForPath = useCallback<Parameters<typeof StreamsSelector>[0]['setCopyStreamIdsForPath']>((path, cb) => {
    setCopyStreamIdsByFile((old) => {
      const oldIds = old[path] || {};
      return ({ ...old, [path]: cb(oldIds) });
    });
  }, []);

  const toggleCopyStreamIdsInternal = useCallback((path: string, streams: FFprobeStream[]) => {
    setCopyStreamIdsForPath(path, (old) => {
      const ret = { ...old };
      // eslint-disable-next-line unicorn/no-array-callback-reference
      streams.forEach(({ index }) => {
        ret[index] = !ret[index];
      });
      return ret;
    });
  }, [setCopyStreamIdsForPath]);

  const toggleCopyStreamIds = useCallback((path: string, filter: (a: FFprobeStream) => boolean) => {
    const streams = path === filePath ? mainStreams : externalFilesMeta[path]?.streams;
    if (!streams) return;
    toggleCopyStreamIdsInternal(path, streams.filter((stream) => filter(stream)));
  }, [externalFilesMeta, filePath, mainStreams, toggleCopyStreamIdsInternal]);

  const filterEnabledStreams = useCallback(async (expr: string) => (await pMap(mainStreams, async (stream) => (
    (await safeishEval(expr, { track: stream })) === true ? [stream] : []
  ), { concurrency: 5 })).flat(), [mainStreams]);

  const applyEnabledStreamsFilter = useCallback(async (expr = enabledStreamsFilter) => {
    if (expr == null) return;
    invariant(filePath != null);

    const filteredStreams = await filterEnabledStreams(expr);

    toggleCopyStreamIdsInternal(filePath, filteredStreams);
  }, [enabledStreamsFilter, filePath, filterEnabledStreams, toggleCopyStreamIdsInternal]);

  const changeEnabledStreamsFilter = useCallback(async () => {
    invariant(filePath != null);

    const isEmpty = (v: string) => v.trim().length === 0;

    const expr = await filterEnabledStreamsDialog({
      validator: async (v: string) => {
        try {
          if (isEmpty(v)) return undefined;
          const streams = await filterEnabledStreams(v);
          if (streams.length === 0) return i18n.t('No tracks match this expression.');
          return undefined;
        } catch (err) {
          if (err instanceof Error) {
            return i18n.t('Expression failed: {{errorMessage}}', { errorMessage: err.message });
          }
          throw err;
        }
      },
      value: enabledStreamsFilter,
    });

    if (expr == null) return;

    if (isEmpty(expr)) {
      setEnabledStreamsFilter(undefined);
      return;
    }

    setEnabledStreamsFilter(expr);

    await applyEnabledStreamsFilter(expr);
  }, [applyEnabledStreamsFilter, enabledStreamsFilter, filePath, filterEnabledStreams]);

  const toggleStripCodecType = useCallback((codecType: FFprobeStream['codec_type']) => toggleCopyStreamIds(filePath!, (stream) => stream.codec_type === codecType), [filePath, toggleCopyStreamIds]);
  const toggleStripAudio = useCallback(() => toggleStripCodecType('audio'), [toggleStripCodecType]);
  const toggleStripVideo = useCallback(() => toggleStripCodecType('video'), [toggleStripCodecType]);
  const toggleStripSubtitle = useCallback(() => toggleStripCodecType('subtitle'), [toggleStripCodecType]);
  const toggleStripThumbnail = useCallback(() => toggleCopyStreamIds(filePath!, isStreamThumbnail), [filePath, toggleCopyStreamIds]);
  const toggleCopyAllStreamsForPath = useCallback((path: string) => toggleCopyStreamIds(path, () => true), [toggleCopyStreamIds]);
  const toggleStripAll = useCallback(() => toggleCopyAllStreamsForPath(filePath!), [filePath, toggleCopyAllStreamsForPath]);

  const toggleCopyStreamId = useCallback((path: string, index: number) => {
    setCopyStreamIdsForPath(path, (old) => ({ ...old, [index]: !old[index] }));
  }, [setCopyStreamIdsForPath]);

  return { nonCopiedExtraStreams, exportExtraStreams, mainCopiedThumbnailStreams, numStreamsToCopy, toggleStripAudio, toggleStripVideo, toggleStripSubtitle, toggleStripThumbnail, toggleStripAll, copyStreamIdsByFile, setCopyStreamIdsByFile, copyFileStreams, mainCopiedStreams, setCopyStreamIdsForPath, toggleCopyStreamId, isCopyingStreamId, toggleCopyStreamIds, changeEnabledStreamsFilter, applyEnabledStreamsFilter, enabledStreamsFilter, toggleCopyAllStreamsForPath };
};
