import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { FilesBrowser } from "./FilesBrowser";
import { CompositeVideoPlayer } from "./CompositeVideoPlayer";
import { Timeline, Track } from "./Timeline";
import { ExportDialog } from "./ExportDialog";
import { EffectsDialog } from "./EffectsDialog";
import { AudioMixerDialog } from "./AudioMixerDialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface MediaFile {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image' | 'effect';
  url: string;
  duration: number;
  file?: File; // Opzionale per gli effetti
  effectType?: string; // Per identificare il tipo di effetto
  effectIntensity?: number; // Intensità dell'effetto (0-100) per zoom, ecc.
}

export interface TimelineItem {
  id: string;
  mediaFile: MediaFile;
  startTime: number;
  duration: number;
  track: number; // 0, 1, or 2
  mediaStartOffset?: number; // Offset in seconds from start of original media file
}

interface HistoryState {
  timelineItems: TimelineItem[];
  currentTime: number;
}

export const VideoEditor = () => {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [history, setHistory] = useState<HistoryState[]>([{ timelineItems: [], currentTime: 0 }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '4:3' | '9:16'>('16:9');
  const [exportFPS, setExportFPS] = useState<24 | 30 | 60>(30); // Nuovo state per FPS
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isEffectsDialogOpen, setIsEffectsDialogOpen] = useState(false);
  const [isAudioMixerOpen, setIsAudioMixerOpen] = useState(false);
  const [selectedTimelineItemId, setSelectedTimelineItemId] = useState<string | undefined>();
  const [trackVolumes, setTrackVolumes] = useState<Map<string, number>>(new Map());
  
  // Throttling per aggiornamenti volume
  const volumeUpdateTimeoutRef = useRef<Map<string, number>>(new Map());

  // Gestione tracce dinamiche
  const [tracks, setTracks] = useState<Track[]>([
    { id: 'video-0', type: 'video', index: 0, label: 'Video 1' },
    { id: 'audio-0', type: 'audio', index: 1, label: 'Audio 1' },
    { id: 'audio-1', type: 'audio', index: 2, label: 'Audio 2' }
  ]);

  // Cleanup per i timeout dei volumi
  useEffect(() => {
    return () => {
      volumeUpdateTimeoutRef.current.forEach(timeoutId => {
        clearTimeout(timeoutId);
      });
      volumeUpdateTimeoutRef.current.clear();
    };
  }, []);

  const { toast } = useToast();

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  // Calcola dinamicamente la durata totale basata sugli elementi nella timeline
  const totalDuration = useMemo(() => {
    if (timelineItems.length === 0) {
      return 60; // Durata minima di default (1 minuto)
    }

    const maxEndTime = timelineItems.reduce((max, item) => {
      const endTime = item.startTime + item.duration;
      return Math.max(max, endTime);
    }, 0);

    // Aggiungi un buffer del 20% o minimo 10 secondi per permettere ulteriori aggiunte
    const buffer = Math.max(maxEndTime * 0.2, 10);
    return Math.ceil(maxEndTime + buffer);
  }, [timelineItems]);

  const handleFilesAdded = (files: MediaFile[]) => {
    setMediaFiles(prev => [...prev, ...files]);
  };

  // Save state to history
  const saveToHistory = (newTimelineItems: TimelineItem[], newCurrentTime: number = currentTime) => {
    const newState: HistoryState = {
      timelineItems: newTimelineItems,
      currentTime: newCurrentTime
    };

    // Remove any future history if we're not at the end
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);

    // Limit history to 50 steps
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      setHistoryIndex(prev => prev + 1);
    }

    setHistory(newHistory);
  };

  // Undo function
  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const previousState = history[newIndex];
      setTimelineItems(previousState.timelineItems);
      setCurrentTime(previousState.currentTime);
      setHistoryIndex(newIndex);
    }
  };

  // Redo function
  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const nextState = history[newIndex];
      setTimelineItems(nextState.timelineItems);
      setCurrentTime(nextState.currentTime);
      setHistoryIndex(newIndex);
    }
  };

  const handleItemAddedToTimeline = (item: TimelineItem) => {
    const newItems = [...timelineItems, item];
    setTimelineItems(newItems);
    saveToHistory(newItems);
  };

  const handleTimelineItemsChange = (items: TimelineItem[]) => {
    setTimelineItems(items);
  };

  const handleTimelineItemsChangeWithHistory = (items: TimelineItem[]) => {
    setTimelineItems(items);
    saveToHistory(items);
  };

  const handleTracksChange = (newTracks: Track[]) => {
    setTracks(newTracks);
  };

  const handleExport = () => {
    if (timelineItems.length === 0) {
      toast({
        title: "No Content to Export",
        description: "Please add some media to the timeline before exporting.",
        variant: "destructive",
      });
      return;
    }

    setIsExportDialogOpen(true);
  };

  const handleOpenEffects = () => {
    setIsEffectsDialogOpen(true);
  };

  const handleOpenAudioMixer = () => {
    setIsAudioMixerOpen(true);
  };

  const handleVolumeChange = useCallback((itemId: string, volume: number) => {
    // Aggiorna immediatamente lo stato per feedback UI immediato
    setTrackVolumes(prev => {
      const newMap = new Map(prev);
      newMap.set(itemId, volume);
      return newMap;
    });

    // Throttling per evitare troppi aggiornamenti rapidamente
    const timeoutMap = volumeUpdateTimeoutRef.current;
    if (timeoutMap.has(itemId)) {
      clearTimeout(timeoutMap.get(itemId));
    }

    const timeoutId = setTimeout(() => {
      // Questo timeout permette agli elementi media di processare il cambio volume
      timeoutMap.delete(itemId);
    }, 50); // 50ms di throttling

    timeoutMap.set(itemId, timeoutId);
  }, []);

  const handleResetVolumes = () => {
    setTrackVolumes(new Map());
  };

  // AGGIORNATO: Funzione per applicare effetti con durate dinamiche e intensità (incluso Blur)
  const handleApplyEffect = (effectId: string, itemId?: string, intensity?: number) => {
    // Trova la prima track video disponibile
    const firstVideoTrack = tracks.find(track => track.type === 'video');
    if (!firstVideoTrack) {
      toast({
        title: "No Video Track Available",
        description: "Please add a video track before applying effects.",
        variant: "destructive",
      });
      return;
    }

    // AGGIORNATO: Definisci le durate predefinite per ogni effetto (incluso blur)
    const effectDurations: { [key: string]: number } = {
      'fade-in': 2,
      'fade-out': 2,
      'black-white': 3,
      'zoom-in': 3,
      'zoom-out': 3,
      'blur': 3 // Nuovo effetto blur
    };

    // Crea un nuovo MediaFile per l'effetto
    const effectName = effectId.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');

    const effectDuration = effectDurations[effectId] || 2;

    const effectMediaFile: MediaFile = {
      id: `effect-${effectId}-${Date.now()}`,
      name: effectName,
      type: 'effect',
      url: '', // Gli effetti non hanno URL
      duration: effectDuration,
      effectType: effectId,
      effectIntensity: intensity
    };

    // Aggiungi l'effetto anche alla lista dei media files per coerenza
    setMediaFiles(prev => [...prev, effectMediaFile]);

    // Posiziona SEMPRE l'effetto al currentTime (cursore rosso)
    let targetStartTime = currentTime;
    
    // Se un elemento è selezionato, posiziona l'effetto all'inizio di quell'elemento
    if (selectedTimelineItemId && itemId) {
      const selectedItem = timelineItems.find(item => item.id === selectedTimelineItemId);
      if (selectedItem) {
        targetStartTime = selectedItem.startTime;
      }
    }

    // Crea un nuovo TimelineItem per l'effetto
    const newEffectItem: TimelineItem = {
      id: `timeline-effect-${Date.now()}-${Math.random()}`,
      mediaFile: effectMediaFile,
      startTime: targetStartTime,
      duration: effectDuration,
      track: firstVideoTrack.index,
      mediaStartOffset: 0
    };

    // Aggiungi l'effetto alla timeline
    const newItems = [...timelineItems, newEffectItem];
    setTimelineItems(newItems);
    saveToHistory(newItems);

    // Messaggio con intensità per effetti personalizzabili
    const intensityText = intensity !== undefined ? ` (${intensity}% intensity)` : '';
    toast({
      title: "Effect Applied",
      description: `${effectName}${intensityText} has been added to the timeline at ${targetStartTime.toFixed(1)}s.`,
    });

    // Chiudi il dialog degli effetti
    setIsEffectsDialogOpen(false);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Files Browser */}
        <div className="w-1/4 min-w-[300px] border-r border-border">
          <FilesBrowser
            files={mediaFiles}
            onFilesAdded={handleFilesAdded}
            onItemAddedToTimeline={handleItemAddedToTimeline}
            timelineItems={timelineItems}
            tracks={tracks}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            historyIndex={historyIndex}
            historyLength={history.length}
          />
        </div>

        {/* Right Panel - Diviso in due sezioni */}
        <div className="flex-1 flex flex-col">
          {/* Video Player - AREA PRINCIPALE CON DIMENSIONI FISSE */}
          <div className="relative bg-card border-b border-border" style={{ height: 'calc(100vh - 384px)' }}>
            <div className="absolute top-4 right-4 z-10 flex items-center gap-3">
              {/* Aspect Ratio Buttons */}
              <div className="flex items-center gap-1 bg-background/80 backdrop-blur-sm border border-border rounded-lg p-1">
                {(['16:9', '4:3', '9:16'] as const).map((ratio) => (
                  <Button
                    key={ratio}
                    onClick={() => setAspectRatio(ratio)}
                    variant={aspectRatio === ratio ? "default" : "ghost"}
                    size="sm"
                    className="h-8 px-2 text-xs font-medium"
                  >
                    {ratio}
                  </Button>
                ))}
              </div>

              {/* FPS Selection Buttons */}
              <div className="flex items-center gap-1 bg-background/80 backdrop-blur-sm border border-border rounded-lg p-1">
                <span className="text-xs text-muted-foreground px-2">FPS:</span>
                {([24, 30, 60] as const).map((fps) => (
                  <Button
                    key={fps}
                    onClick={() => setExportFPS(fps)}
                    variant={exportFPS === fps ? "default" : "ghost"}
                    size="sm"
                    className="h-8 px-2 text-xs font-medium"
                  >
                    {fps}
                  </Button>
                ))}
              </div>

              <Button
                onClick={handleExport}
                className="bg-gradient-primary hover:opacity-90 shadow-elegant"
                size="lg"
              >
                <Download className="w-4 h-4 mr-2" />
                Export Video
              </Button>
            </div>

            <div className="h-full overflow-hidden">
              <CompositeVideoPlayer
                timelineItems={timelineItems}
                currentTime={currentTime}
                isPlaying={isPlaying}
                onTimeUpdate={setCurrentTime}
                onPlayStateChange={setIsPlaying}
                aspectRatio={aspectRatio}
                trackVolumes={trackVolumes}
              />
            </div>
          </div>

          {/* Area inferiore - Controlli aggiuntivi RIDOTTI */}
          <div className="h-16 bg-muted/10 flex items-center justify-center px-6 border-b border-border">
            <div className="flex items-center space-x-3">
              <span className="text-sm font-medium text-muted-foreground">Quick Tools:</span>
              <Button variant="outline" size="sm" onClick={handleOpenEffects}>Effects</Button>
              <Button variant="outline" size="sm">Colors</Button>
              <Button variant="outline" size="sm" onClick={handleOpenAudioMixer}>Audio Mixer</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Panel - Timeline */}
      <div className="h-1/3 border-t border-border bg-timeline-bg">
        <Timeline
          items={timelineItems}
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          onItemsChange={handleTimelineItemsChange}
          onItemsChangeWithHistory={handleTimelineItemsChangeWithHistory}
          totalDuration={totalDuration}
          tracks={tracks}
          onTracksChange={handleTracksChange}
          onItemSelect={setSelectedTimelineItemId}
        />
      </div>

      {/* Export Dialog */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        timelineItems={timelineItems}
        totalDuration={totalDuration}
        aspectRatio={aspectRatio}
        selectedFPS={exportFPS}
        trackVolumes={trackVolumes}
      />

      {/* Effects Dialog */}
      <EffectsDialog
        isOpen={isEffectsDialogOpen}
        onClose={() => setIsEffectsDialogOpen(false)}
        timelineItems={timelineItems}
        selectedItemId={selectedTimelineItemId}
        onApplyEffect={handleApplyEffect}
      />

      {/* Audio Mixer Dialog */}
      <AudioMixerDialog
        isOpen={isAudioMixerOpen}
        onClose={() => setIsAudioMixerOpen(false)}
        timelineItems={timelineItems}
        trackVolumes={trackVolumes}
        onVolumeChange={handleVolumeChange}
        onResetVolumes={handleResetVolumes}
      />
    </div>
  );
};