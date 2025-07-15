import { useState, useRef, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { TimelineItem } from "./VideoEditor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Copy, Scissors, Trash2, Plus } from "lucide-react";

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId?: string; selectedItems?: string[] } | null>(null);
  const [copiedItem, setCopiedItem] = useState<TimelineItem | null>(null);
  const [copiedItems, setCopiedItems] = useState<TimelineItem[]>([]); // Per copia multipla
  const [resizing, setResizing] = useState<{ itemId: string; edge: 'left' | 'right' } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  
  // Stati per le tracce dinamiche
  const [tracks, setTracks] = useState<{
    video: number[];
    audio: number[];
  }>({
    video: [0],
    audio: [1, 2]
  });
  
  // Stati per la selezione multipla
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  
  // Stati per il magnetic snap
  const [snapThreshold] = useState(15); // pixels per il snap
  const [activeSnapLines, setActiveSnapLines] = useState<number[]>([]);
  
  // Stato per il drag con snap (incluso drag multiplo)
  const [dragState, setDragState] = useState<{
    startX: number;
    startY: number;
    originalStartTime: number;
    originalTrack: number;
    currentStartTime: number;
    currentTrack: number;
    snapPoints: { time: number; type: 'start' | 'end' | 'timeline-start' }[];
    potentialSnapTime?: number; // Tempo di snap potenziale
    isInSnapRange: boolean; // Se è dentro la soglia di snap
    // Per drag multiplo
    draggedItems: {
      id: string;
      originalStartTime: number;
      originalTrack: number;
      timeOffset: number; // Offset rispetto all'elemento principale
      trackOffset: number; // Offset di track rispetto all'elemento principale
    }[];
  } | null>(null);

  // Calcola tutte le tracce disponibili
  const allTracks = [...tracks.video, ...tracks.audio].sort((a, b) => a - b);
  const maxTrack = Math.max(...allTracks, 2);

  // Calcola l'altezza dinamica della timeline
  const timelineHeight = (allTracks.length + 1) * 60 + 16; // +1 per buffer, +16 per padding

  // Zoom functionality con Ctrl+Scroll
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        
        const zoomFactor = 1.1;
        const delta = e.deltaY;
        
        setScale(prevScale => {
          let newScale;
          if (delta < 0) {
            newScale = prevScale * zoomFactor;
          } else {
            newScale = prevScale / zoomFactor;
          }
          
          return Math.max(minScale, Math.min(maxScale, newScale));
        });
      }
    };

    const timelineElement = timelineContentRef.current;
    if (timelineElement) {
      timelineElement.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (timelineElement) {
        timelineElement.removeEventListener('wheel', handleWheel);
      }
    };
  }, [minScale, maxScale]);

  // Calcola la larghezza effettiva della timeline
  const timelineWidth = Math.max(totalDuration * scale, 1000,
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

  // Handle scroll della timeline
  const handleTimelineContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const newScrollLeft = e.currentTarget.scrollLeft;
    setScrollLeft(newScrollLeft);

    if (timelineHeaderContentRef.current) {
      timelineHeaderContentRef.current.style.transform = `translateX(-${newScrollLeft}px)`;
    }
  };

  // Handle timeline click to change time
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!isDragging && !resizing && !draggedItem && !isSelecting) {
      const mouseX = e.clientX - 80 + scrollLeft;
      const newTime = mouseX / scale;
      onTimeChange(Math.max(0, Math.min(newTime, totalDuration)));
    }
  };

  // Generate time markers
  const generateTimeMarkers = () => {
    const markers = [];
    
    let interval = 5;
    if (scale < 20) {
      interval = 30;
    } else if (scale < 40) {
      interval = 15;
    } else if (scale > 100) {
      interval = 1;
    } else if (scale > 80) {
      interval = 2;
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
          <span 
            className="text-xs text-muted-foreground font-mono"
            style={{
              position: 'absolute',
              top: '20px',
              left: isFirstMarker ? '0px' : '-20px',
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

  // Calculate snap points for magnetic borders
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

  // Find potential snap point (per il feedback visivo)
  const findPotentialSnapPoint = useCallback((currentTime: number, duration: number, snapPoints: { time: number; type: 'start' | 'end' | 'timeline-start' }[]) => {
    const snapThresholdTime = snapThreshold / scale;
    
    // Controlla snap per l'inizio dell'elemento
    for (const snapPoint of snapPoints) {
      if (Math.abs(currentTime - snapPoint.time) <= snapThresholdTime) {
        return {
          snapTime: snapPoint.time,
          snapLine: snapPoint.time,
          type: 'start'
        };
      }
    }
    
    // Controlla snap per la fine dell'elemento
    for (const snapPoint of snapPoints) {
      if (Math.abs((currentTime + duration) - snapPoint.time) <= snapThresholdTime) {
        return {
          snapTime: snapPoint.time - duration,
          snapLine: snapPoint.time,
          type: 'end'
        };
      }
    }
    
    return null;
  }, [scale, snapThreshold]);

  // Validate track compatibility
  const isValidTrack = useCallback((track: number, mediaType: string) => {
    if (!allTracks.includes(track)) return false;
    
    const trackType = getTrackType(track);
    
    if (mediaType === 'video' || mediaType === 'image') {
      return trackType === 'video';
    }
    if (mediaType === 'audio') {
      return trackType === 'audio';
    }
    return false;
  }, [allTracks, getTrackType]);

  // Calcola gli elementi dentro il rettangolo di selezione
  const getItemsInSelectionRect = useCallback(() => {
    if (!selectionStart || !selectionEnd) return [];

    const left = Math.min(selectionStart.x, selectionEnd.x);
    const right = Math.max(selectionStart.x, selectionEnd.x);
    const top = Math.min(selectionStart.y, selectionEnd.y);
    const bottom = Math.max(selectionStart.y, selectionEnd.y);

    return items.filter(item => {
      const itemLeft = item.startTime * scale;
      const itemRight = itemLeft + item.duration * scale;
      const itemTop = item.track * 60 + 8;
      const itemBottom = itemTop + 48; // altezza elemento

      // Controlla se c'è sovrapposizione
      return !(itemRight < left || itemLeft > right || itemBottom < top || itemTop > bottom);
    });
  }, [selectionStart, selectionEnd, items, scale]);

  // Handle context menu actions
  const handleCopy = (item?: TimelineItem) => {
    if (selectedItems.size > 1) {
      // Copia multipla
      const itemsToCopy = items.filter(i => selectedItems.has(i.id));
      setCopiedItems(itemsToCopy.map(i => ({ ...i, id: `${i.id}_copy` })));
      setCopiedItem(null);
    } else if (item) {
      // Copia singola
      setCopiedItem({ ...item, id: `${item.id}_copy` });
      setCopiedItems([]);
    }
    setContextMenu(null);
  };

  const handlePaste = (track: number) => {
    if (copiedItems.length > 0) {
      // Incolla multiplo
      const newItems = copiedItems.map(copiedItem => ({
        ...copiedItem,
        id: `${copiedItem.id}_${Date.now()}_${Math.random()}`,
        track: isValidTrack(track, copiedItem.mediaFile.type) ? track : copiedItem.track,
        startTime: currentTime,
        mediaStartOffset: copiedItem.mediaStartOffset || 0
      }));
      onItemsChangeWithHistory([...items, ...newItems]);
    } else if (copiedItem) {
      // Incolla singolo
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

  const handleDelete = (itemId?: string) => {
    if (selectedItems.size > 1) {
      // Eliminazione multipla
      const newItems = items.filter(item => !selectedItems.has(item.id));
      onItemsChangeWithHistory(newItems);
      setSelectedItems(new Set());
    } else if (itemId) {
      // Eliminazione singola
      onItemsChangeWithHistory(items.filter(item => item.id !== itemId));
    }
    setContextMenu(null);
  };

  // Handle item selection
  const handleItemClick = (e: React.MouseEvent, item: TimelineItem) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click: aggiungi/rimuovi dalla selezione
      e.preventDefault();
      e.stopPropagation();
      
      setSelectedItems(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(item.id)) {
          newSelection.delete(item.id);
        } else {
          newSelection.add(item.id);
        }
        return newSelection;
      });
    } else {
      // Click normale: seleziona solo questo elemento
      setSelectedItems(new Set([item.id]));
    }
  };

  // Handle drag start
  const handleMouseDown = (e: React.MouseEvent, item?: TimelineItem, isResize?: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    if (isResize && item) {
      setResizing({ itemId: item.id, edge: isResize });
      return;
    }

    if (item) {
      // Drag di un elemento
      const rect = timelineContentRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left + scrollLeft;
      const mouseY = e.clientY - rect.top;

      // Se l'elemento non è selezionato e non si tiene Ctrl, selezionalo
      if (!selectedItems.has(item.id) && !(e.ctrlKey || e.metaKey)) {
        setSelectedItems(new Set([item.id]));
      }

      // Prepara dati per drag multiplo
      const currentSelection = selectedItems.has(item.id) ? selectedItems : new Set([item.id]);
      const draggedItemsData = Array.from(currentSelection).map(itemId => {
        const targetItem = items.find(i => i.id === itemId);
        if (!targetItem) return null;

        return {
          id: itemId,
          originalStartTime: targetItem.startTime,
          originalTrack: targetItem.track,
          timeOffset: targetItem.startTime - item.startTime, // Offset rispetto all'elemento principale
          trackOffset: allTracks.indexOf(targetItem.track) - allTracks.indexOf(item.track) // Offset di indice track rispetto all'elemento principale
        };
      }).filter(Boolean) as {
        id: string;
        originalStartTime: number;
        originalTrack: number;
        timeOffset: number;
        trackOffset: number;
      }[];

      // Calcola i punti di snap per la track corrente dell'elemento principale
      const snapPoints = calculateSnapPoints(item.id, item.track);

      // Stato del drag con snap e supporto multiplo
      setDragState({
        startX: mouseX,
        startY: mouseY,
        originalStartTime: item.startTime,
        originalTrack: allTracks.indexOf(item.track), // Usa indice invece del numero
        currentStartTime: item.startTime,
        currentTrack: allTracks.indexOf(item.track), // Usa indice invece del numero
        snapPoints,
        isInSnapRange: false,
        draggedItems: draggedItemsData
      });

      setIsDragging(true);
      setDraggedItem(item.id);
    } else {
      // Inizio selezione rettangolare
      const rect = timelineContentRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left + scrollLeft;
      const mouseY = e.clientY - rect.top;

      setIsSelecting(true);
      setSelectionStart({ x: mouseX, y: mouseY });
      setSelectionEnd({ x: mouseX, y: mouseY });

      // Pulisci selezione se non si tiene Ctrl
      if (!(e.ctrlKey || e.metaKey)) {
        setSelectedItems(new Set());
      }
    }
  };

  // Handle selezione rettangolare sulla timeline vuota
  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    // Solo se clicca su area vuota (non su elementi)
    if (!isDragging && !resizing) {
      handleMouseDown(e);
    }
  };

  // Handle mouse move con snap magnetico
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineContentRef.current) return;
      const rect = timelineContentRef.current.getBoundingClientRect();

      if (isSelecting && selectionStart) {
        // Aggiorna selezione rettangolare
        const mouseX = e.clientX - rect.left + scrollLeft;
        const mouseY = e.clientY - rect.top;
        
        setSelectionEnd({ x: mouseX, y: mouseY });

        // Calcola elementi nella selezione in tempo reale
        const itemsInRect = getItemsInSelectionRect();
        const newSelection = new Set(selectedItems);
        
        itemsInRect.forEach(item => {
          if (e.ctrlKey || e.metaKey) {
            // Con Ctrl: toggle
            if (selectedItems.has(item.id)) {
              newSelection.delete(item.id);
            } else {
              newSelection.add(item.id);
            }
          } else {
            // Senza Ctrl: aggiungi
            newSelection.add(item.id);
          }
        });

        setSelectedItems(newSelection);
      } else if (resizing) {
        // Logica di resize con snap
        const mouseX = e.clientX - rect.left + scrollLeft;
        const newTime = mouseX / scale;

        const item = items.find(i => i.id === resizing.itemId);
        if (!item) return;

        const snapPoints = calculateSnapPoints(resizing.itemId, item.track);
        const snapThresholdTime = snapThreshold / scale;

        const updatedItems = items.map(i => {
          if (i.id === resizing.itemId) {
            if (resizing.edge === 'left') {
              const maxStartTime = i.startTime + i.duration - 0.1;
              let newStartTime = newTime;
              let snapLineTime: number | undefined;

              // Cerca snap per il resize left
              for (const snapPoint of snapPoints) {
                if (Math.abs(newTime - snapPoint.time) <= snapThresholdTime) {
                  newStartTime = snapPoint.time;
                  snapLineTime = snapPoint.time;
                  break;
                }
              }

              newStartTime = Math.max(0, Math.min(newStartTime, maxStartTime));
              const durationChange = i.startTime - newStartTime;

              // Aggiorna snap lines
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

              // Cerca snap per il resize right
              for (const snapPoint of snapPoints) {
                if (Math.abs(newTime - snapPoint.time) <= snapThresholdTime) {
                  newEndTime = snapPoint.time;
                  snapLineTime = snapPoint.time;
                  break;
                }
              }

              newEndTime = Math.max(minEndTime, newEndTime);

              // Aggiorna snap lines
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
      } else if (isDragging && draggedItem && dragState) {
        // Logica di drag con snap magnetico
        const mouseX = e.clientX - rect.left + scrollLeft;
        const mouseY = e.clientY - rect.top - 16;

        const deltaX = mouseX - dragState.startX;
        const deltaY = mouseY - dragState.startY;

        // Calcola nuova posizione senza snap
        const rawNewTime = Math.max(0, dragState.originalStartTime + deltaX / scale);
        const newTrackIndex = Math.max(0, Math.min(allTracks.length - 1, dragState.originalTrack + Math.round(deltaY / 60)));
        const newTrack = allTracks[newTrackIndex];

        const draggedItemData = items.find(i => i.id === draggedItem);
        if (!draggedItemData) return;

        // Aggiorna i punti di snap se cambia track
        let currentSnapPoints = dragState.snapPoints;
        if (newTrackIndex !== dragState.currentTrack) {
          currentSnapPoints = calculateSnapPoints(draggedItem, newTrack);
        }

        // Trova potenziale snap point
        const potentialSnap = findPotentialSnapPoint(rawNewTime, draggedItemData.duration, currentSnapPoints);
        
        let finalTime = rawNewTime;
        let snapLines: number[] = [];
        let isInSnapRange = false;

        if (potentialSnap) {
          // Mostra la linea di snap
          snapLines = [potentialSnap.snapLine];
          isInSnapRange = true;
          // Ma NON applica lo snap durante il movimento - lascia libertà di movimento
        }

        // Aggiorna lo stato del drag
        setDragState(prev => prev ? {
          ...prev,
          currentStartTime: finalTime,
          currentTrack: newTrackIndex,
          snapPoints: currentSnapPoints,
          potentialSnapTime: potentialSnap?.snapTime,
          isInSnapRange
        } : null);

        // Aggiorna le linee di snap
        setActiveSnapLines(snapLines);

        // Aggiorna la posizione dell'elemento in tempo reale (sempre movimento libero)
        if (isValidTrack(newTrack, draggedItemData.mediaFile.type)) {
          const updatedItems = items.map(item => {
            if (dragState.draggedItems.some(draggedItem => draggedItem.id === item.id)) {
              // Trova i dati dell'elemento trascinato
              const draggedItemInfo = dragState.draggedItems.find(di => di.id === item.id);
              if (!draggedItemInfo) return item;

              if (item.id === draggedItem) {
                // Elemento principale - usa la posizione calcolata
                return {
                  ...item,
                  startTime: finalTime,
                  track: newTrack
                };
              } else {
                // Elemento secondario - calcola posizione relativa
                const newItemTime = finalTime + draggedItemInfo.timeOffset;
                const originalTrackIndex = allTracks.indexOf(draggedItemInfo.originalTrack);
                const trackIndexOffset = newTrackIndex - dragState.originalTrack;
                const newItemTrackIndex = originalTrackIndex + trackIndexOffset;
                
                // Verifica se la nuova posizione è valida
                if (newItemTime >= 0 && newItemTrackIndex >= 0 && newItemTrackIndex < allTracks.length) {
                  const newItemTrack = allTracks[newItemTrackIndex];
                  if (isValidTrack(newItemTrack, item.mediaFile.type)) {
                    return {
                      ...item,
                      startTime: newItemTime,
                      track: newItemTrack
                    };
                  }
                }
                // Se la posizione non è valida, mantieni quella originale
                return item;
              }
            }
            return item;
          });
          onItemsChange(updatedItems);
        }
      }
    };

    const handleMouseUp = () => {
      if (isSelecting) {
        // Fine selezione rettangolare
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionEnd(null);
      } else if (isDragging && draggedItem && dragState) {
        // Al rilascio: applica lo snap solo se siamo dentro la soglia
        const draggedItemData = items.find(i => i.id === draggedItem);
        if (draggedItemData) {
          let finalTime = dragState.currentStartTime;
          
          // Applica snap solo se è dentro la soglia E abbiamo un tempo di snap
          if (dragState.isInSnapRange && dragState.potentialSnapTime !== undefined) {
            finalTime = dragState.potentialSnapTime;
          }

          const finalItems = items.map(item => {
            if (dragState.draggedItems.some(draggedItem => draggedItem.id === item.id)) {
              // Trova i dati dell'elemento trascinato
              const draggedItemInfo = dragState.draggedItems.find(di => di.id === item.id);
              if (!draggedItemInfo) return item;

              if (item.id === draggedItem) {
                // Elemento principale
                const finalTrack = allTracks[dragState.currentTrack];
                if (isValidTrack(finalTrack, draggedItemData.mediaFile.type)) {
                  return {
                    ...item,
                    startTime: finalTime,
                    track: finalTrack
                  };
                } else {
                  // Track non valido, ripristina posizione originale
                  const originalTrack = allTracks[dragState.originalTrack];
                  return {
                    ...item,
                    startTime: dragState.originalStartTime,
                    track: originalTrack
                  };
                }
              } else {
                // Elemento secondario - calcola posizione finale relativa
                const newItemTime = finalTime + draggedItemInfo.timeOffset;
                const originalTrackIndex = allTracks.indexOf(draggedItemInfo.originalTrack);
                const trackIndexOffset = dragState.currentTrack - dragState.originalTrack;
                const newItemTrackIndex = originalTrackIndex + trackIndexOffset;

                // Verifica se la nuova posizione è valida
                if (newItemTime >= 0 && newItemTrackIndex >= 0 && newItemTrackIndex < allTracks.length) {
                  const newItemTrack = allTracks[newItemTrackIndex];
                  if (isValidTrack(newItemTrack, item.mediaFile.type)) {
                    return {
                      ...item,
                      startTime: newItemTime,
                      track: newItemTrack
                    };
                  }
                }
                // Se la posizione non è valida, ripristina quella originale
                return {
                  ...item,
                  startTime: draggedItemInfo.originalStartTime,
                  track: draggedItemInfo.originalTrack
                };
              }
            }
            return item;
          });

          // Salva nella history
          onItemsChangeWithHistory(finalItems);
        }
      }

      // Reset di tutti gli stati
      setIsDragging(false);
      setDraggedItem(null);
      setDragState(null);
      setResizing(null);
      setActiveSnapLines([]);
    };

    if (isDragging || resizing || isSelecting) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, draggedItem, dragState, resizing, isSelecting, selectionStart, items, scale, scrollLeft, 
      calculateSnapPoints, findPotentialSnapPoint, isValidTrack, onItemsChange, onItemsChangeWithHistory, 
      selectedItems, getItemsInSelectionRect]);

  // Render timeline item
  const renderTimelineItem = (item: TimelineItem, track: number) => {
    const isDraggedItem = draggedItem === item.id;
    const isSelected = selectedItems.has(item.id);
    const isPartOfDrag = isDragging && dragState?.draggedItems.some(di => di.id === item.id);
    
    const left = item.startTime * scale;
    const width = item.duration * scale;
    const topPosition = track * 60 + 8;

    const trackColors = {
      video: 'bg-blue-600',
      audio: 'bg-green-600',
      image: 'bg-purple-600'
    };

    return (
      <div
        key={item.id}
        className={`absolute h-12 rounded border-2 cursor-move transition-none group
          ${trackColors[item.mediaFile.type]} ${
          isDraggedItem ? 'z-30 opacity-80 shadow-lg' : 
          isPartOfDrag ? 'z-25 opacity-75 shadow-md' : 'z-10'
        } ${
          isSelected ? 'border-yellow-400 ring-2 ring-yellow-400/50' : 'border-white/20'
        } ${
          isPartOfDrag && !isDraggedItem ? 'ring-2 ring-blue-400/50' : ''
        }`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
          top: `${topPosition}px`,
          transform: isPartOfDrag ? 'scale(1.02)' : 'none'
        }}
        onMouseDown={(e) => {
          // Se clicca con Ctrl, gestisci la selezione
          if (e.ctrlKey || e.metaKey) {
            handleItemClick(e, item);
          } else {
            handleMouseDown(e, item);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (selectedItems.size > 1 && selectedItems.has(item.id)) {
            // Context menu per selezione multipla
            setContextMenu({ 
              x: e.clientX, 
              y: e.clientY, 
              selectedItems: Array.from(selectedItems) 
            });
          } else {
            // Context menu per elemento singolo
            setContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
          }
        }}
      >
        {/* Resize handles - SOLO per immagini e non durante drag multiplo */}
        {item.mediaFile.type === 'image' && !isPartOfDrag && (
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
          {/* Indicatore di drag multiplo */}
          {isPartOfDrag && selectedItems.size > 1 && (
            <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
              {selectedItems.size}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render selection rectangle
  const renderSelectionRect = () => {
    if (!isSelecting || !selectionStart || !selectionEnd) return null;

    const left = Math.min(selectionStart.x, selectionEnd.x);
    const top = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    return (
      <div
        className="absolute pointer-events-none z-50 border border-yellow-400 bg-yellow-400/20"
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`
        }}
      />
    );
  };

  // Group items by track
  // Rimosso: ora usiamo allTracks direttamente

  return (
    <div className="h-full flex flex-col bg-timeline-bg">
      {/* Zoom Indicator */}
      <div className="absolute top-2 right-4 z-40 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm">
        Zoom: {Math.round((scale / 50) * 100)}%
        <div className="text-[10px] text-gray-400 mt-1">Ctrl+Scroll per zoom</div>
        {selectedItems.size > 0 && (
          <div className="text-[10px] text-yellow-400 mt-1">
            {selectedItems.size} elementi selezionati
          </div>
        )}
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

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 bg-playhead z-30 pointer-events-none"
              style={{ 
                left: `${playheadPosition}px`,
                width: '2px'
              }}
            >
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
          {allTracks.map((trackNumber, index) => {
            const trackType = getTrackType(trackNumber);
            const trackName = getTrackName(trackNumber);
            const isLastVideoTrack = trackType === 'video' && trackNumber === tracks.video[tracks.video.length - 1];
            const isLastAudioTrack = trackType === 'audio' && trackNumber === tracks.audio[tracks.audio.length - 1];
            
            return (
              <div key={trackNumber}>
                <div
                  className="absolute w-full h-14 flex flex-col items-center justify-center text-xs font-medium text-muted-foreground border-b border-border/30"
                  style={{ top: `${index * 60 + 8}px` }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (copiedItems.length > 0 || copiedItem) {
                      if (copiedItems.length > 0) {
                        handlePaste(trackNumber);
                      } else if (copiedItem && isValidTrack(trackNumber, copiedItem.mediaFile.type)) {
                        handlePaste(trackNumber);
                      }
                    }
                  }}
                >
                  <span className="text-center">{trackName}</span>
                  
                  {/* Pulsante + per aggiungere tracce */}
                  {(isLastVideoTrack || isLastAudioTrack) && (
                    <button
                      onClick={trackType === 'video' ? addVideoTrack : addAudioTrack}
                      className="mt-1 w-5 h-5 bg-primary/20 hover:bg-primary/40 text-primary rounded-full flex items-center justify-center transition-colors"
                      title={`Aggiungi traccia ${trackType === 'video' ? 'video' : 'audio'}`}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Timeline Content */}
        <div
          className="ml-20 relative h-full overflow-x-auto overflow-y-hidden"
          onScroll={handleTimelineContentScroll}
          ref={timelineContentRef}
          onMouseDown={handleTimelineMouseDown}
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#374151 #1f2937'
          }}
        >
          <div
            className="relative"
            style={{ width: `${timelineWidth}px`, height: `${timelineHeight}px` }}
          >
            {/* Track Backgrounds */}
            {allTracks.map((trackNumber, index) => (
              <div
                key={trackNumber}
                className="absolute w-full h-14 border-b border-border/30"
                style={{ top: `${index * 60 + 8}px` }}
              />
            ))}

            {/* Timeline Items */}
            {allTracks.map((trackNumber) =>
              items
                .filter(item => item.track === trackNumber)
                .map(item => {
                  const trackIndex = allTracks.indexOf(item.track);
                  return renderTimelineItem(item, trackIndex);
                })
            )}

            {/* Grid Lines */}
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

            {/* Snap Lines (barrette gialle) */}
            {activeSnapLines.map((snapTime, index) => (
              <div
                key={`snap-${index}`}
                className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 pointer-events-none z-40 shadow-lg"
                style={{ left: `${snapTime * scale}px` }}
              />
            ))}

            {/* Selection Rectangle */}
            {renderSelectionRect()}
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
              if (contextMenu.selectedItems && contextMenu.selectedItems.length > 1) {
                // Copia multipla
                handleCopy();
              } else if (contextMenu.itemId) {
                // Copia singola
                const item = items.find(i => i.id === contextMenu.itemId);
                if (item) handleCopy(item);
              }
            }}
          >
            <Copy className="w-3 h-3 mr-2" />
            {contextMenu.selectedItems ? `Copy ${contextMenu.selectedItems.length} items` : 'Copy'}
          </Button>
          
          {/* Split solo per elemento singolo */}
          {contextMenu.itemId && !contextMenu.selectedItems && (
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
          )}
          
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-3 py-1.5 h-auto text-xs text-destructive hover:text-destructive"
            onClick={() => {
              if (contextMenu.selectedItems) {
                handleDelete();
              } else {
                handleDelete(contextMenu.itemId);
              }
            }}
          >
            <Trash2 className="w-3 h-3 mr-2" />
            {contextMenu.selectedItems ? `Delete ${contextMenu.selectedItems.length} items` : 'Delete'}
          </Button>
        </div>
      )}
    </div>
  );
};