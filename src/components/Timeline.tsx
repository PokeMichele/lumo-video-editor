import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { TimelineItem } from "./VideoEditor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Copy, Scissors, Trash2 } from "lucide-react";

interface TimelineProps {
  items: TimelineItem[];
  currentTime: number;
  onTimeChange: (time: number) => void;
  onItemsChange: (items: TimelineItem[]) => void;
  onItemsChangeWithHistory: (items: TimelineItem[]) => void;
  totalDuration: number;
}

export const Timeline = ({
  items,
  currentTime,
  onTimeChange,
  onItemsChange,
  onItemsChangeWithHistory,
  totalDuration
}: TimelineProps) => {
  const timelineHeaderContentRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const dragPreviewRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>();

  const [isDragging, setIsDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(50); // pixels per second
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);
  const [copiedItem, setCopiedItem] = useState<TimelineItem | null>(null);
  const [resizing, setResizing] = useState<{ itemId: string; edge: 'left' | 'right' } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [initialItemsForDrag, setInitialItemsForDrag] = useState<TimelineItem[] | null>(null);
  const [snapThreshold] = useState(15); // pixels for snapping
  const [activeSnapLines, setActiveSnapLines] = useState<number[]>([]);

  // Stato per il drag preview ottimizzato
  const [dragPreview, setDragPreview] = useState<{
    itemId: string;
    x: number;
    y: number;
    width: number;
    track: number;
    startTime: number;
    duration: number;
    snapped: boolean;
    snapLine?: number;
  } | null>(null);

  // Memoized calculations
  const timelineWidth = useMemo(() => Math.max(
    totalDuration * scale,
    1000,
    ...items.map(item => (item.startTime + item.duration) * scale + 100)
  ), [totalDuration, scale, items]);

  const playheadPosition = useMemo(() => currentTime * scale, [currentTime, scale]);

  // Apply dark scrollbar styles
  useEffect(() => {
    if (timelineContentRef.current) {
      const element = timelineContentRef.current;
      const style = document.createElement('style');
      style.textContent = `
        .timeline-scrollbar::-webkit-scrollbar {
          height: 12px;
        }
        .timeline-scrollbar::-webkit-scrollbar-track {
          background: #1f2937;
          border-radius: 6px;
        }
        .timeline-scrollbar::-webkit-scrollbar-thumb {
          background: #374151;
          border-radius: 6px;
          border: 2px solid #1f2937;
        }
        .timeline-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4b5563;
        }
      `;
      document.head.appendChild(style);
      element.classList.add('timeline-scrollbar');

      return () => {
        document.head.removeChild(style);
      };
    }
  }, []);

  // Handle scroll della timeline - solo dal contenuto
  const handleTimelineContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollLeft = e.currentTarget.scrollLeft;
    setScrollLeft(newScrollLeft);

    // Sincronizza l'header spostando il contenuto interno
    if (timelineHeaderContentRef.current) {
      timelineHeaderContentRef.current.style.transform = `translateX(-${newScrollLeft}px)`;
    }
  }, []);

  // Handle timeline click to change time
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!isDragging && !resizing && !draggedItem) {
      const mouseX = e.clientX - 80 + scrollLeft; // 80px = larghezza labels
      const newTime = mouseX / scale;
      onTimeChange(Math.max(0, Math.min(newTime, totalDuration)));
    }
  }, [isDragging, resizing, draggedItem, scrollLeft, scale, totalDuration, onTimeChange]);

  // Generate time markers - ottimizzato con useMemo
  const timeMarkers = useMemo(() => {
    const markers = [];
    const interval = totalDuration > 60 ? 10 : 5; // 10s intervals for long videos, 5s for short

    for (let i = 0; i <= totalDuration; i += interval) {
      const position = i * scale;
      markers.push(
        <div
          key={i}
          className="absolute top-0 flex flex-col items-center"
          style={{ left: `${position}px` }}
        >
          <div className="w-px h-4 bg-timeline-ruler"></div>
          <span className="text-xs text-muted-foreground mt-1 font-mono">
            {formatTime(i)}
          </span>
        </div>
      );
    }
    return markers;
  }, [totalDuration, scale]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Calculate snap points for magnetic borders - ottimizzato
  const calculateSnapPoints = useCallback((draggedItemId: string, targetTrack: number) => {
    const snapPoints: number[] = [0]; // Always snap to timeline start

    // Get all items in the same track except the dragged one
    const otherItemsInTrack = items.filter(item =>
      item.track === targetTrack && item.id !== draggedItemId
    );

    // Add start and end points of all other items
    otherItemsInTrack.forEach(item => {
      snapPoints.push(item.startTime); // Start of item
      snapPoints.push(item.startTime + item.duration); // End of item
    });

    return [...new Set(snapPoints)].sort((a, b) => a - b); // Remove duplicates and sort
  }, [items]);

  // Find the closest snap point - ottimizzato
  const findSnapPoint = useCallback((currentTime: number, snapPoints: number[]): { time: number; snapped: boolean; snapLine?: number } => {
    const snapThresholdTime = snapThreshold / scale; // Convert pixels to time

    for (const snapPoint of snapPoints) {
      if (Math.abs(currentTime - snapPoint) <= snapThresholdTime) {
        return { time: snapPoint, snapped: true, snapLine: snapPoint };
      }
    }

    return { time: currentTime, snapped: false }; // No snap point found
  }, [snapThreshold, scale]);

  // Handle context menu actions
  const handleCopy = useCallback((item: TimelineItem) => {
    setCopiedItem({ ...item, id: `${item.id}_copy` });
    setContextMenu(null);
  }, []);

  const handlePaste = useCallback((track: number) => {
    if (copiedItem) {
      const newItem = {
        ...copiedItem,
        id: `${copiedItem.id}_${Date.now()}`,
        track,
        startTime: currentTime,
        mediaStartOffset: copiedItem.mediaStartOffset || 0 // Mantiene l'offset del media copiato
      };
      onItemsChangeWithHistory([...items, newItem]);
    }
  }, [copiedItem, currentTime, items, onItemsChangeWithHistory]);

  const handleSplit = useCallback((item: TimelineItem) => {
    const splitTime = currentTime - item.startTime;
    if (splitTime > 0 && splitTime < item.duration) {
      const originalMediaOffset = item.mediaStartOffset || 0;

      const firstPart = {
        ...item,
        duration: splitTime,
        mediaStartOffset: originalMediaOffset // Mantiene l'offset originale
      };

      const secondPart = {
        ...item,
        id: `${item.id}_split_${Date.now()}`,
        startTime: item.startTime + splitTime,
        duration: item.duration - splitTime,
        mediaStartOffset: originalMediaOffset + splitTime // Offset aumentato del tempo di split
      };

      const newItems = items.filter(i => i.id !== item.id);
      onItemsChangeWithHistory([...newItems, firstPart, secondPart]);
    }
    setContextMenu(null);
  }, [currentTime, items, onItemsChangeWithHistory]);

  const handleDelete = useCallback((itemId: string) => {
    onItemsChangeWithHistory(items.filter(item => item.id !== itemId));
    setContextMenu(null);
  }, [items, onItemsChangeWithHistory]);

  // Ottimizzazione: funzione per aggiornare il preview visuale senza toccare lo state
  const updateDragPreview = useCallback((mouseX: number, mouseY: number, draggedItemData: TimelineItem) => {
    const newTime = Math.max(0, mouseX / scale);
    const newTrack = Math.floor(mouseY / 60);

    // Validate track compatibility
    const isValidTrack = (track: number, mediaType: string) => {
      if (track < 0 || track > 2) return false;
      if (mediaType === 'video' || mediaType === 'image') return track === 0;
      if (mediaType === 'audio') return track === 1 || track === 2;
      return false;
    };

    if (isValidTrack(newTrack, draggedItemData.mediaFile.type)) {
      // Calculate snap points for the target track
      const snapPoints = calculateSnapPoints(draggedItemData.id, newTrack);
      const snapResult = findSnapPoint(newTime, snapPoints);

      setDragPreview({
        itemId: draggedItemData.id,
        x: snapResult.time * scale,
        y: newTrack * 60 + 8,
        width: draggedItemData.duration * scale,
        track: newTrack,
        startTime: snapResult.time,
        duration: draggedItemData.duration,
        snapped: snapResult.snapped,
        snapLine: snapResult.snapLine
      });

      // Update snap lines
      if (snapResult.snapped && snapResult.snapLine !== undefined) {
        setActiveSnapLines([snapResult.snapLine]);
      } else {
        setActiveSnapLines([]);
      }
    }
  }, [scale, calculateSnapPoints, findSnapPoint]);

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent, item: TimelineItem, isResize?: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    // Save initial state for history
    setInitialItemsForDrag([...items]);

    if (isResize) {
      setResizing({ itemId: item.id, edge: isResize });
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    setIsDragging(true);
    setDraggedItem(item.id);

    // Inizializza il drag preview
    setDragPreview({
      itemId: item.id,
      x: item.startTime * scale,
      y: item.track * 60 + 8,
      width: item.duration * scale,
      track: item.track,
      startTime: item.startTime,
      duration: item.duration,
      snapped: false
    });
  }, [items, scale]);

  // Handle mouse move ottimizzato con requestAnimationFrame
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        if (resizing && timelineContentRef.current) {
          const rect = timelineContentRef.current.getBoundingClientRect();
          const mouseX = e.clientX - rect.left + scrollLeft;
          const newTime = mouseX / scale;

          const item = items.find(i => i.id === resizing.itemId);
          if (!item) return;

          // Calculate snap points for resizing
          const snapPoints = calculateSnapPoints(resizing.itemId, item.track);

          const updatedItems = items.map(i => {
            if (i.id === resizing.itemId) {
              if (resizing.edge === 'left') {
                const maxStartTime = i.startTime + i.duration - 0.1;
                const snapResult = findSnapPoint(newTime, snapPoints);
                const newStartTime = Math.max(0, Math.min(snapResult.time, maxStartTime));
                const durationChange = i.startTime - newStartTime;

                // Update snap lines
                if (snapResult.snapped && snapResult.snapLine !== undefined) {
                  setActiveSnapLines([snapResult.snapLine]);
                } else {
                  setActiveSnapLines([]);
                }

                return {
                  ...i,
                  startTime: newStartTime,
                  duration: i.duration + durationChange
                };
              } else {
                const minEndTime = i.startTime + 0.1;
                const snapResult = findSnapPoint(newTime, snapPoints);
                const newEndTime = Math.max(minEndTime, snapResult.time);

                // Update snap lines
                if (snapResult.snapped && snapResult.snapLine !== undefined) {
                  setActiveSnapLines([snapResult.snapLine]);
                } else {
                  setActiveSnapLines([]);
                }

                return {
                  ...i,
                  duration: newEndTime - i.startTime
                };
              }
            }
            return i;
          });
          onItemsChange(updatedItems);
        } else if (isDragging && draggedItem && timelineContentRef.current) {
          const rect = timelineContentRef.current.getBoundingClientRect();
          const mouseX = e.clientX - rect.left + scrollLeft;
          const mouseY = e.clientY - rect.top - 16; // Account for header

          const draggedItemData = items.find(i => i.id === draggedItem);
          if (!draggedItemData) return;

          // Aggiorna solo il preview visuale, non lo state
          updateDragPreview(mouseX, mouseY, draggedItemData);
        }
      });
    };

    const handleMouseUp = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      // Apply final changes only on mouse up
      if (isDragging && dragPreview && draggedItem) {
        const updatedItems = items.map(item =>
          item.id === draggedItem
            ? { ...item, startTime: dragPreview.startTime, track: dragPreview.track }
            : item
        );
        onItemsChangeWithHistory(updatedItems);
      } else if (resizing && initialItemsForDrag) {
        // Check if anything actually changed for resize
        const hasChanges = JSON.stringify(items) !== JSON.stringify(initialItemsForDrag);
        if (hasChanges) {
          onItemsChangeWithHistory(items);
        }
      }

      setIsDragging(false);
      setDraggedItem(null);
      setResizing(null);
      setInitialItemsForDrag(null);
      setActiveSnapLines([]);
      setDragPreview(null);
    };

    if (isDragging || resizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, draggedItem, resizing, dragPreview, items, scale, scrollLeft, onItemsChange, onItemsChangeWithHistory, calculateSnapPoints, findSnapPoint, updateDragPreview]);

  // Render timeline item ottimizzato
  const renderTimelineItem = useCallback((item: TimelineItem, track: number) => {
    const left = item.startTime * scale;
    const width = item.duration * scale;

    const trackColors = {
      video: 'bg-video-track',
      audio: 'bg-audio-track',
      image: 'bg-video-track' // Images use video track color
    };

    // Se questo item è quello che stiamo trascinando e abbiamo un preview, nascondi l'originale
    const isBeingDragged = draggedItem === item.id && dragPreview;
    const opacity = isBeingDragged ? 'opacity-20' : 'opacity-100';

    return (
      <div
        key={item.id}
        className={`absolute h-12 rounded border-2 border-white/20 cursor-move transition-opacity group
          ${trackColors[item.mediaFile.type]} ${opacity} z-10`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
          top: `${track * 60 + 8}px`
        }}
        onMouseDown={(e) => handleMouseDown(e, item)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
        }}
      >
        {/* Resize handles */}
        <div
          className="absolute left-0 top-0 w-1 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/50"
          onMouseDown={(e) => handleMouseDown(e, item, 'left')}
        />
        <div
          className="absolute right-0 top-0 w-1 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/50"
          onMouseDown={(e) => handleMouseDown(e, item, 'right')}
        />

        <div className="p-2 h-full flex items-center justify-between text-white text-xs overflow-hidden select-none">
          <span className="truncate flex-1 select-none">{item.mediaFile.name}</span>
          <span className="ml-2 font-mono select-none">{formatTime(item.duration)}</span>
        </div>
      </div>
    );
  }, [scale, draggedItem, dragPreview, handleMouseDown, formatTime]);

  // Group items by track - ottimizzato con useMemo
  const trackItems = useMemo(() => [0, 1, 2].map(trackIndex =>
    items.filter(item => item.track === trackIndex)
  ), [items]);

  return (
    <div className="h-full flex flex-col bg-timeline-bg">
      {/* Timeline Header with Time Markers - NO SCROLLBAR */}
      <div className="relative h-16 bg-gradient-timeline border-b border-border">
        <div className="absolute left-0 top-0 w-20 h-full bg-secondary/50 border-r border-border z-30 flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onTimeChange(0)}
            className="w-10 h-10 p-0 hover:bg-accent/50 rounded-md transition-colors"
            title="Go to start (0:00)"
          >
            <div className="w-0 h-0 border-t-[6px] border-b-[6px] border-r-[10px] border-t-transparent border-b-transparent border-r-muted-foreground"></div>
          </Button>
        </div>
        <div className="relative h-full cursor-pointer overflow-hidden ml-20">
          <div
            ref={timelineHeaderContentRef}
            className="relative h-full"
            style={{ width: `${timelineWidth}px` }}
            onClick={handleTimelineClick}
          >
            {/* Time Markers */}
            {timeMarkers}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-playhead z-30 pointer-events-none"
              style={{ left: `${playheadPosition}px` }}
            >
              <div className="absolute -top-1 -left-2 w-4 h-4 bg-playhead rotate-45 transform"></div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Tracks */}
      <div className="flex-1 relative overflow-hidden">
        {/* Track Labels */}
        <div className="absolute left-0 top-0 w-20 h-full bg-secondary/50 border-r border-border z-20">
          {['Video', 'Audio 1', 'Audio 2'].map((label, index) => (
            <div
              key={label}
              className="absolute w-full h-14 flex items-center justify-center text-xs font-medium text-muted-foreground border-b border-border/30"
              style={{ top: `${index * 60 + 8}px` }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (copiedItem) {
                  const isValidTrack = (track: number, mediaType: string) => {
                    if (mediaType === 'video' || mediaType === 'image') return track === 0;
                    if (mediaType === 'audio') return track === 1 || track === 2;
                    return false;
                  };

                  if (isValidTrack(index, copiedItem.mediaFile.type)) {
                    handlePaste(index);
                  }
                }
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Timeline Content - UNICA SCROLLBAR */}
        <div
          className="ml-20 relative h-full overflow-x-auto overflow-y-hidden"
          onScroll={handleTimelineContentScroll}
          ref={timelineContentRef}
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#374151 #1f2937'
          }}
        >
          <div
            className="relative h-48"
            style={{ width: `${timelineWidth}px` }}
          >
            {/* Track Backgrounds */}
            {[0, 1, 2].map(track => (
              <div
                key={track}
                className="absolute w-full h-14 border-b border-border/30"
                style={{ top: `${track * 60 + 8}px` }}
              />
            ))}

            {/* Timeline Items */}
            {trackItems.map((trackItems, trackIndex) =>
              trackItems.map(item => renderTimelineItem(item, trackIndex))
            )}

            {/* Drag Preview - elemento che segue il mouse fluidamente */}
            {dragPreview && (
              <div
                className={`absolute h-12 rounded border-2 border-yellow-400 cursor-move transition-all z-30
                  ${dragPreview.snapped ? 'shadow-lg shadow-yellow-400/50' : ''}
                  bg-blue-500/80`}
                style={{
                  left: `${dragPreview.x}px`,
                  width: `${dragPreview.width}px`,
                  top: `${dragPreview.y}px`,
                  transform: 'translateZ(0)', // Force hardware acceleration
                  willChange: 'transform'
                }}
              >
                <div className="p-2 h-full flex items-center justify-between text-white text-xs overflow-hidden select-none">
                  <span className="truncate flex-1 select-none">
                    {items.find(i => i.id === dragPreview.itemId)?.mediaFile.name}
                  </span>
                  <span className="ml-2 font-mono select-none">{formatTime(dragPreview.duration)}</span>
                </div>
              </div>
            )}

            {/* Grid Lines */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: Math.ceil(totalDuration / 10) }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-px bg-border/30"
                  style={{ left: `${i * 10 * scale}px` }}
                />
              ))}
            </div>

            {/* Snap Lines - visible during dragging or resizing */}
            {(isDragging || resizing) && activeSnapLines.map((snapTime, index) => (
              <div
                key={`snap-${index}`}
                className="absolute top-0 bottom-0 w-0.5 bg-yellow-400/80 pointer-events-none z-20 shadow-sm"
                style={{ left: `${snapTime * scale}px` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-popover border border-border rounded-md shadow-lg z-50 py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-3 py-1.5 h-auto text-xs"
            onClick={() => {
              const item = items.find(i => i.id === contextMenu.itemId);
              if (item) handleCopy(item);
            }}
          >
            <Copy className="w-3 h-3 mr-2" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-3 py-1.5 h-auto text-xs"
            onClick={() => {
              const item = items.find(i => i.id === contextMenu.itemId);
              if (item) handleSplit(item);
            }}
          >
            <Scissors className="w-3 h-3 mr-2" />
            Split
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-3 py-1.5 h-auto text-xs text-destructive hover:text-destructive"
            onClick={() => handleDelete(contextMenu.itemId)}
          >
            <Trash2 className="w-3 h-3 mr-2" />
            Delete
          </Button>
        </div>
      )}
    </div>
  );
};
