@echo off
echo ==============================================================================
echo  Quick XeLaTeX Compilation (Single Pass) ...
echo ==============================================================================

xelatex -synctex=1 -interaction=nonstopmode -file-line-error main.tex

if %errorlevel% neq 0 (
    echo [ERROR] Compilation failed! Check main.log.
) else (
    echo ==============================================================================
    echo  [SUCCESS] main.pdf updated successfully!
    echo ==============================================================================
)

pause
