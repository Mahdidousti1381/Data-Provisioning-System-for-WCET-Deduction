@echo off
echo ==============================================================================
echo  Compiling Tehran University Thesis with XeLaTeX ...
echo ==============================================================================

if not exist main.tex (
    echo [ERROR] main.tex not found! Please run this file inside the Thesis directory.
    pause
    exit /b 1
)

echo [1/4] Running XeLaTeX pass 1...
xelatex -synctex=1 -interaction=nonstopmode -file-line-error main.tex
if %errorlevel% neq 0 (
    echo [ERROR] Compilation failed in Pass 1! Please check main.log.
    pause
    exit /b %errorlevel%
)

echo [2/4] Updating citations with BibTeX...
bibtex main

echo [3/4] Running XeLaTeX pass 2...
xelatex -synctex=1 -interaction=nonstopmode -file-line-error main.tex

echo [4/4] Running XeLaTeX pass 3 (finalizing page numbers and TOC)...
xelatex -synctex=1 -interaction=nonstopmode -file-line-error main.tex

if exist main.pdf (
    echo ==============================================================================
    echo  [SUCCESS] main.pdf created successfully!
    echo ==============================================================================
) else (
    echo [ERROR] main.pdf was not generated.
)

pause
