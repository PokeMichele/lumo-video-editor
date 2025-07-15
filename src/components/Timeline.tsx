import { useState, useRef, useEffect, useCallback } from "react";
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

// Throttle function per limitare la frequenza delle chiamate
const throttle = (func: Function, limit: number) => {
  let inThrottle: boolean;
  return function(this: any, ...args: any[]) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
};

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
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(50); // pixels per second
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);
  const [copiedItem, setCopiedItem] = useState<TimelineItem | null>(null);
  const [resizing, setResizing] = useState<{ itemId: string; edge: 'left' | 'right' } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [initialItemsForDrag, setInitialItemsForDrag] = useState<TimelineItem[] | null>(null);
  
  // FIXED: Ridotto threshold di snap per renderlo meno "magnetico"
  const [snapThreshold] = useState(10); // Ridotto da 15 a 10 pixel per essere meno invasivo
  const [visualSnapThreshold] = useState(15); // pixels for showing snap lines
  const [activeSnapLines, setActiveSnapLines] = useState<number[]>([]);

  // Stati per il drag ottimizzato
  const [dragPreview, setDragPreview] = useState<{
    itemId: string;
    startTime: number;
    track: number;
    isSnapped: boolean;
    snapLineTime?: number;
    isValidPosition?: boolean; // NUOVO: indica se la posizione è valida
  } | null>(null);

  // Limiti per lo zoom
  const minScale = 10; // minimo zoom out
  const maxScale = 200; // massimo zoom in

  const dragStateRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startTime: number;
    startTrack: number;
    snapPoints: { time: number; type: 'start' | 'end' | 'timeline-start' }[];
    draggedItemDuration: number;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    startTrack: 0,
    snapPoints: [],
    draggedItemDuration: 0
  });

  // Zoom functionality con Ctrl+Scroll
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Solo se Ctrl è premuto
      if (e.ctrlKey) {
        e.preventDefault(); // Previeni il zoom della pagina
        
        const zoomFactor = 1.1; // Fattore di zoom
        const delta = e.deltaY;
        
        setScale(prevScale => {
          let newScale;
          if (delta < 0) {
            // Scroll up = Zoom In (aumenta scale)
            newScale = prevScale * zoomFactor;
          } else {
            // Scroll down = Zoom Out (diminuisci scale)
            newScale = prevScale / zoomFactor;
          }
          
          // Applica i limiti
          return Math.max(minScale, Math.min(maxScale, newScale));
        });
      }
    };

    // Aggiungi l'event listener alla timeline content
    const timelineElement = timelineContentRef.current;
    if (timelineElement) {
      timelineElement.addEventListener('wheel', handleWheel, { passive: false });
    }

    // Cleanup
    return () => {
      if (timelineElement) {
        timelineElement.removeEventListener('wheel', handleWheel);
      }
    };
  }, [minScale, maxScale]);

  // Calcola la larghezza effettiva della timeline in base al contenuto
  const timelineWidth = Math.max(totalDuration * scale, 1000,
    // Assicurati che sia abbastanza larga per tutti gli elementi
    ...items.map(item => (item.startTime + item.duration) * scale + 100)
  );
  const playheadPosition = currentTime * scale;

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
  const handleTimelineContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const newScrollLeft = e.currentTarget.scrollLeft;
    setScrollLeft(newScrollLeft);

    // Sincronizza l'header spostando il contenuto interno
    if (timelineHeaderContentRef.current) {
      timelineHeaderContentRef.current.style.transform = `translateX(-${newScrollLeft}px)`;
    }
  };

  // Handle timeline click to change time
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!isDragging && !resizing && !draggedItem) {
      const mouseX = e.clientX - 80 + scrollLeft; // 80px = larghezza labels
      const newTime = mouseX / scale;
      onTimeChange(Math.max(0, Math.min(newTime, totalDuration)));
    }
  };

  // Generate time markers - FIXED: Linea del timestamp 0:00 perfettamente allineata all'inizio
  const generateTimeMarkers = () => {
    const markers = [];
    
    // Calcola l'intervallo dinamicamente in base al livello di zoom
    let interval = 5; // default
    if (scale < 20) {
      interval = 30; // zoom out molto
    } else if (scale < 40) {
      interval = 15; // zoom out
    } else if (scale > 100) {
      interval = 1; // zoom in molto
    } else if (scale > 80) {
      interval = 2; // zoom in
    }

    for (let i = 0; i <= totalDuration; i += interval) {
      const position = i * scale;
      const isFirstMarker = i === 0;
      
      markers.push(
        <div
          key={i}
          className="absolute top-0"
          style={{ left: `${position}px` }}
        >
          {/* Linea sempre a left: 0 rispetto al suo container */}
          <div 
            className="bg-timeline-ruler"
            style={{
              width: '1px',
              height: '16px',
              position: 'absolute',
              left: '0px',
              top: '0px'
            }}
          ></div>
          {/* Testo posizionato in base al marker */}
          <span 
            className="text-xs text-muted-foreground font-mono"
            style={{
              position: 'absolute',
              top: '20px',
              left: isFirstMarker ? '0px' : '-20px', // Prima: allineato a sinistra, altri: centrati
              minWidth: '40px',
              textAlign: isFirstMarker ? 'left' : 'center'
            }}
          >
            {formatTime(i)}
          </span>
        </div>
      );
    }
    return markers;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate snap points for magnetic borders - OTTIMIZZATO
  const calculateSnapPoints = useCallback((draggedItemId: string, targetTrack: number) => {
    const snapPoints: { time: number; type: 'start' | 'end' | 'timeline-start' }[] = [];

    // Always snap to timeline start
    snapPoints.push({ time: 0, type: 'timeline-start' });

    // Get all items in the same track except the dragged one
    const otherItemsInTrack = items.filter(item =>
      item.track === targetTrack && item.id !== draggedItemId
    );

    // Add start and end points of all other items
    otherItemsInTrack.forEach(item => {
      snapPoints.push({ time: item.startTime, type: 'start' });
      snapPoints.push({ time: item.startTime + item.duration, type: 'end' });
    });

    return snapPoints.sort((a, b) => a.time - b.time);
  }, [items]);

  // FIXED: Detection di sovrapposizione semplificata e più permissiva
  const wouldCauseOverlap = useCallback((startTime: number, duration: number, track: number, excludeId: string) => {
    const itemEnd = startTime + duration;
    
    return items.some(item => {
      if (item.id === excludeId || item.track !== track) return false;
      
      const otherStart = item.startTime;
      const otherEnd = item.startTime + item.duration;
      
      // Sovrapposizione vera: un elemento inizia prima che l'altro finisca
      const hasRealOverlap = (startTime < otherEnd && itemEnd > otherStart);
      
      return hasRealOverlap;
    });
  }, [items]);

  // FIXED: Logica di snap drasticamente semplificata - priorità al movimento libero
  const findSnapPoint = useCallback((currentTime: number, snapPoints: { time: number; type: 'start' | 'end' | 'timeline-start' }[], draggedItemDuration: number, targetTrack: number, draggedItemId: string): { 
    time: number; 
    snapped: boolean; 
    snapLine?: number; 
    showSnapLine?: boolean 
  } => {
    const snapThresholdTime = snapThreshold / scale;
    
    // PRIMA COSA: Se la posizione corrente è valida, usala SEMPRE
    if (currentTime >= 0 && !wouldCauseOverlap(currentTime, draggedItemDuration, targetTrack, draggedItemId)) {
      // Controlla se c'è un snap point molto vicino (solo per l'assistenza visiva)
      for (const snapPoint of snapPoints) {
        if (Math.abs(currentTime - snapPoint.time) <= snapThresholdTime) {
          if (snapPoint.time >= 0 && !wouldCauseOverlap(snapPoint.time, draggedItemDuration, targetTrack, draggedItemId)) {
            return {
              time: snapPoint.time,
              snapped: true,
              snapLine: snapPoint.time,
              showSnapLine: true
            };
          }
        }
        
        if (Math.abs((currentTime + draggedItemDuration) - snapPoint.time) <= snapThresholdTime) {
          const snapTime = snapPoint.time - draggedItemDuration;
          if (snapTime >= 0 && !wouldCauseOverlap(snapTime, draggedItemDuration, targetTrack, draggedItemId)) {
            return {
              time: snapTime,
              snapped: true,
              snapLine: snapPoint.time,
              showSnapLine: true
            };
          }
        }
      }
      
      // Nessun snap ma posizione valida - usa la posizione corrente
      return { time: currentTime, snapped: false, showSnapLine: false };
    }
    
    // SOLO se la posizione corrente non è valida, cerca una alternativa
    return { time: Math.max(0, currentTime), snapped: false, showSnapLine: false };
  }, [scale, snapThreshold, wouldCauseOverlap]);

  // Validate track compatibility
  const isValidTrack = useCallback((track: number, mediaType: string) => {
    if (track < 0 || track > 2) return false;
    if (mediaType === 'video' || mediaType === 'image') return track === 0;
    if (mediaType === 'audio') return track === 1 || track === 2;
    return false;
  }, []);

  // Handle context menu actions
  const handleCopy = (item: TimelineItem) => {
    setCopiedItem({ ...item, id: `${item.id}_copy` });
    setContextMenu(null);
  };

  const handlePaste = (track: number) => {
    if (copiedItem) {
      const newItem = {
        ...copiedItem,
        id: `${copiedItem.id}_${Date.now()}`,
        track,
        startTime: currentTime,
        mediaStartOffset: copiedItem.mediaStartOffset || 0
      };
      onItemsChangeWithHistory([...items, newItem]);
    }
  };

  const handleSplit = (item: TimelineItem) => {
    const splitTime = currentTime - item.startTime;
    if (splitTime > 0 && splitTime < item.duration) {
      const originalMediaOffset = item.mediaStartOffset || 0;

      const firstPart = {
        ...item,
        duration: splitTime,
        mediaStartOffset: originalMediaOffset
      };

      const secondPart = {
        ...item,
        id: `${item.id}_split_${Date.now()}`,
        startTime: item.startTime + splitTime,
        duration: item.duration - splitTime,
        mediaStartOffset: originalMediaOffset + splitTime
      };

      const newItems = items.filter(i => i.id !== item.id);
      onItemsChangeWithHistory([...newItems, firstPart, secondPart]);
    }
    setContextMenu(null);
  };

  const handleDelete = (itemId: string) => {
    onItemsChangeWithHistory(items.filter(item => item.id !== itemId));
    setContextMenu(null);
  };

  // Handle drag start
  const handleMouseDown = (e: React.MouseEvent, item: TimelineItem, isResize?: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    console.log(`=== Starting drag for item: ${item.mediaFile.name} ===`);
    console.log(`Initial position: ${item.startTime}s on track ${item.track}`);

    // Save initial state for history
    setInitialItemsForDrag([...items]);

    if (isResize) {
      setResizing({ itemId: item.id, edge: isResize });
      return;
    }

    const rect = timelineContentRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left + scrollLeft;

    // Salva lo stato iniziale del drag
    dragStateRef.current = {
      isDragging: true,
      startX: mouseX,
      startY: e.clientY - rect.top,
      startTime: item.startTime,
      startTrack: item.track,
      snapPoints: calculateSnapPoints(item.id, item.track),
      draggedItemDuration: item.duration
    };

    setDragOffset({
      x: e.clientX - e.currentTarget.getBoundingClientRect().left,
      y: e.clientY - e.currentTarget.getBoundingClientRect().top
    });
    setIsDragging(true);
    setDraggedItem(item.id);

    // Inizializza il drag preview
    setDragPreview({
      itemId: item.id,
      startTime: item.startTime,
      track: item.track,
      isSnapped: false,
      isValidPosition: true // Posizione iniziale è sempre valida
    });
  };

  // Throttled update durante il drag
  const throttledUpdateItems = useCallback(
    throttle((updatedItems: TimelineItem[]) => {
      onItemsChange(updatedItems);
    }, 8),
    [onItemsChange]
  );

  // Handle mouse move for dragging and resizing with improved snap logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineContentRef.current) return;

      if (resizing) {
        // Resize logic con snap migliorato
        const rect = timelineContentRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + scrollLeft;
        const newTime = mouseX / scale;

        const item = items.find(i => i.id === resizing.itemId);
        if (!item) return;

        const snapPoints = calculateSnapPoints(resizing.itemId, item.track);

        const updatedItems = items.map(i => {
          if (i.id === resizing.itemId) {
            if (resizing.edge === 'left') {
              const maxStartTime = i.startTime + i.duration - 0.1;
              let newStartTime = newTime;
              let snapLineTime: number | undefined;

              // FIXED: Snap più preciso per il resize
              for (const snapPoint of snapPoints) {
                const distanceToSnap = Math.abs(newTime - snapPoint.time);
                const snapThresholdTime = snapThreshold / scale;
                
                if (distanceToSnap <= snapThresholdTime) {
                  const testDuration = (i.startTime + i.duration) - snapPoint.time;
                  if (testDuration > 0.1 && !wouldCauseOverlap(snapPoint.time, testDuration, i.track, i.id)) {
                    newStartTime = snapPoint.time;
                    snapLineTime = snapPoint.time;
                    break;
                  }
                }
              }

              newStartTime = Math.max(0, Math.min(newStartTime, maxStartTime));
              const durationChange = i.startTime - newStartTime;

              if (snapLineTime !== undefined) {
                setActiveSnapLines([snapLineTime]);
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
              let newEndTime = newTime;
              let snapLineTime: number | undefined;

              // FIXED: Snap più preciso per il resize della fine
              for (const snapPoint of snapPoints) {
                const distanceToSnap = Math.abs(newTime - snapPoint.time);
                const snapThresholdTime = snapThreshold / scale;
                
                if (distanceToSnap <= snapThresholdTime) {
                  const testDuration = snapPoint.time - i.startTime;
                  if (testDuration > 0.1 && !wouldCauseOverlap(i.startTime, testDuration, i.track, i.id)) {
                    newEndTime = snapPoint.time;
                    snapLineTime = snapPoint.time;
                    break;
                  }
                }
              }

              newEndTime = Math.max(minEndTime, newEndTime);

              if (snapLineTime !== undefined) {
                setActiveSnapLines([snapLineTime]);
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
      } else if (isDragging && draggedItem && dragStateRef.current.isDragging) {
        // FIXED: Logica di drag migliorata
        const rect = timelineContentRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + scrollLeft;
        const mouseY = e.clientY - rect.top - 16;

        const rawTime = Math.max(0, mouseX / scale);
        const newTrack = Math.floor(mouseY / 60);

        const draggedItemData = items.find(i => i.id === draggedItem);
        if (!draggedItemData) return;

        // Verifica validità track
        if (isValidTrack(newTrack, draggedItemData.mediaFile.type)) {
          // FIXED: MOVIMENTO LIBERO - usa sempre la posizione del mouse
          let finalTime = rawTime;
          let snapped = false;
          let snapLine: number | undefined;
          
          // Calcola snap points solo per assistenza visiva (non per bloccare)
          let snapPoints = dragStateRef.current.snapPoints;
          if (newTrack !== dragStateRef.current.startTrack) {
            snapPoints = calculateSnapPoints(draggedItem, newTrack);
            dragStateRef.current.snapPoints = snapPoints;
            dragStateRef.current.startTrack = newTrack;
          }
          
          // Controlla snap SOLO per assistenza visiva
          const snapThresholdTime = snapThreshold / scale;
          for (const snapPoint of snapPoints) {
            if (Math.abs(rawTime - snapPoint.time) <= snapThresholdTime) {
              finalTime = snapPoint.time;
              snapped = true;
              snapLine = snapPoint.time;
              break;
            }
            
            if (Math.abs((rawTime + draggedItemData.duration) - snapPoint.time) <= snapThresholdTime) {
              finalTime = snapPoint.time - draggedItemData.duration;
              snapped = true;
              snapLine = snapPoint.time;
              break;
            }
          }
          
          // Assicurati che il tempo non sia negativo
          finalTime = Math.max(0, finalTime);

          // Update snap lines
          if (snapped && snapLine !== undefined) {
            setActiveSnapLines([snapLine]);
          } else {
            setActiveSnapLines([]);
          }

          // SEMPRE VALIDO - aggiorna il drag preview
          const newDragPreview = {
            itemId: draggedItem,
            startTime: finalTime,
            track: newTrack,
            isSnapped: snapped,
            snapLineTime: snapLine,
            isValidPosition: true // SEMPRE valido
          };

          setDragPreview(newDragPreview);
        } else {
          // Track non valido - ma permetti comunque il movimento visivo
          const newDragPreview = {
            itemId: draggedItem,
            startTime: Math.max(0, rawTime),
            track: newTrack,
            isSnapped: false,
            isValidPosition: false // Solo per feedback visivo
          };

          setDragPreview(newDragPreview);
          setActiveSnapLines([]);
        }
      }
    };

    const handleMouseUp = () => {
      console.log('=== Mouse Up - Final Drop ===');
      let finalItems = [...items];
      
      // FIXED: Applica la posizione finale con controllo solo del track
      if (isDragging && draggedItem && dragPreview) {
        console.log(`Applying final position: ${dragPreview.startTime}s on track ${dragPreview.track}`);
        
        const draggedItemData = items.find(i => i.id === draggedItem);
        if (draggedItemData) {
          // Verifica solo se il track è valido per il tipo di media
          if (isValidTrack(dragPreview.track, draggedItemData.mediaFile.type)) {
            finalItems = items.map(item =>
              item.id === draggedItem
                ? { ...item, startTime: dragPreview.startTime, track: dragPreview.track }
                : item
            );
            console.log('✅ Final position applied');
          } else {
            console.log('❌ Invalid track for media type, keeping original position');
            finalItems = initialItemsForDrag || items;
          }
        }
      }

      // Applica sempre le modifiche
      onItemsChange(finalItems);

      // Salva nella history solo se ci sono modifiche effettive
      if (initialItemsForDrag) {
        const hasChanges = JSON.stringify(finalItems) !== JSON.stringify(initialItemsForDrag);
        if (hasChanges) {
          console.log('💾 Saving drag changes to history');
          onItemsChangeWithHistory(finalItems);
        } else {
          console.log('⏸️  No changes detected, not saving to history');
        }
      }

      // Reset di tutti gli stati
      setIsDragging(false);
      setDraggedItem(null);
      setDragPreview(null);
      setResizing(null);
      setInitialItemsForDrag(null);
      setActiveSnapLines([]);
      dragStateRef.current.isDragging = false;
      console.log('=== Drag completed ===\n');
    };

    if (isDragging || resizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, draggedItem, resizing, items, scale, scrollLeft,
      calculateSnapPoints, findSnapPoint, isValidTrack, onItemsChangeWithHistory, throttledUpdateItems]);

  // Render timeline item with improved drag preview handling
  const renderTimelineItem = (item: TimelineItem, track: number) => {
    const isDraggedItem = draggedItem === item.id;
    
    // Use drag preview data if available, otherwise use item data
    let displayStartTime = item.startTime;
    let displayTrack = track;
    
    if (isDraggedItem && dragPreview) {
      displayStartTime = dragPreview.startTime;
      displayTrack = dragPreview.track;
    }

    const left = displayStartTime * scale;
    const width = item.duration * scale;
    const topPosition = displayTrack * 60 + 8;

    const trackColors = {
      video: 'bg-blue-600',    // Azzurro per video
      audio: 'bg-green-600',   // Verde per audio
      image: 'bg-purple-600'   // Viola per immagini
    };

    // NUOVO: Indica visivamente se la posizione durante il drag è valida
    const isInvalidDrag = isDraggedItem && dragPreview?.isValidPosition === false;
    const dragOpacity = isDraggedItem ? (isInvalidDrag ? 'opacity-40' : 'opacity-70') : '';
    const dragBorder = isInvalidDrag ? 'border-red-500' : 'border-white/20';

    return (
      <div
        key={item.id}
        className={`absolute h-12 rounded border-2 cursor-move transition-none group
          ${trackColors[item.mediaFile.type]} ${dragOpacity} ${dragBorder} ${
          isDraggedItem ? 'z-30 shadow-lg' : 'z-10'
        }`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
          top: `${topPosition}px`,
          transform: isDraggedItem ? 'scale(1.02)' : 'none'
        }}
        onMouseDown={(e) => handleMouseDown(e, item)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
        }}
      >
        {/* Resize handles - SOLO per immagini */}
        {item.mediaFile.type === 'image' && (
          <>
            <div
              className="absolute left-0 top-0 w-1 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/50"
              onMouseDown={(e) => handleMouseDown(e, item, 'left')}
            />
            <div
              className="absolute right-0 top-0 w-1 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/50"
              onMouseDown={(e) => handleMouseDown(e, item, 'right')}
            />
          </>
        )}

        <div className="p-2 h-full flex items-center justify-between text-white text-xs overflow-hidden select-none">
          <span className="truncate flex-1 select-none">{item.mediaFile.name}</span>
          <span className="ml-2 font-mono select-none">{formatTime(item.duration)}</span>
        </div>
      </div>
    );
  };

  // Group items by track
  const trackItems = [0, 1, 2].map(trackIndex =>
    items.filter(item => item.track === trackIndex)
  );

  return (
    <div className="h-full flex flex-col bg-timeline-bg">
      {/* Zoom Indicator */}
      <div className="absolute top-2 right-4 z-40 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm">
        Zoom: {Math.round((scale / 50) * 100)}%
        <div className="text-[10px] text-gray-400 mt-1">Ctrl+Scroll per zoom</div>
      </div>

      {/* Timeline Header with Time Markers */}
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
            {generateTimeMarkers()}

            {/* FIXED: Playhead with properly centered diamond */}
            <div
              className="absolute top-0 bottom-0 bg-playhead z-30 pointer-events-none"
              style={{ 
                left: `${playheadPosition}px`,
                width: '2px'
              }}
            >
              {/* FIXED: Diamante perfettamente centrato (linea 2px, diamante 16px, quindi -7px per centrare) */}
              <div 
                className="absolute bg-playhead rotate-45" 
                style={{ 
                  top: '-4px',
                  left: '-7px',
                  width: '16px',
                  height: '16px'
                }}
              ></div>
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

        {/* Timeline Content */}
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

            {/* Grid Lines - dinamiche in base al zoom */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: Math.ceil(totalDuration / (scale > 80 ? 1 : scale > 40 ? 5 : 10)) }).map((_, i) => {
                const interval = scale > 80 ? 1 : scale > 40 ? 5 : 10;
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 w-px bg-border/30"
                    style={{ left: `${i * interval * scale}px` }}
                  />
                );
              })}
            </div>

            {/* FIXED: Snap Lines con maggiore visibilità */}
            {(isDragging || resizing) && activeSnapLines.map((snapTime, index) => (
              <div
                key={`snap-${index}`}
                className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 pointer-events-none z-20 shadow-lg"
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