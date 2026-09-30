#!/usr/bin/env python3
"""
Build MetaAves bird/taxonomy data from the official AviList v2025b XLSX.

Usage:
  python scripts/import_avilist.py path/to/AviList-v2025b-extended.xlsx

The importer treats AviList as the authoritative ranked taxonomy and
automatically finds the AviList extended worksheet, so minor worksheet
name/capitalization changes do not break the import.
"""

import json
import re
import sys
from pathlib import Path

from openpyxl import load_workbook


# Broad phylogenetic backbone used by MetaAves. These assignments intentionally
# stop at stable/useful named clades rather than encoding every disputed deep
# Neoaves relationship.
CLADE_PATHS_BY_ORDER = {
    "Struthioniformes": [
        "Neornithes",
        "Palaeognathae"
    ],
    "Casuariiformes": [
        "Neornithes",
        "Palaeognathae"
    ],
    "Apterygiformes": [
        "Neornithes",
        "Palaeognathae"
    ],
    "Rheiformes": [
        "Neornithes",
        "Palaeognathae"
    ],
    "Tinamiformes": [
        "Neornithes",
        "Palaeognathae"
    ],
    "Anseriformes": [
        "Neornithes",
        "Neognathae",
        "Galloanserae"
    ],
    "Galliformes": [
        "Neornithes",
        "Neognathae",
        "Galloanserae"
    ],
    "Phoenicopteriformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Mirandornithes"
    ],
    "Podicipediformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Mirandornithes"
    ],
    "Mesitornithiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Columbaves",
        "Columbimorphae"
    ],
    "Pterocliformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Columbaves",
        "Columbimorphae"
    ],
    "Columbiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Columbaves",
        "Columbimorphae"
    ],
    "Musophagiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Columbaves",
        "Otidimorphae"
    ],
    "Otidiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Columbaves",
        "Otidimorphae"
    ],
    "Cuculiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Columbaves",
        "Otidimorphae"
    ],
    "Gaviiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Phaethoquornithes",
        "Aequornithes"
    ],
    "Sphenisciformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Phaethoquornithes",
        "Aequornithes"
    ],
    "Procellariiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Phaethoquornithes",
        "Aequornithes"
    ],
    "Ciconiiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Phaethoquornithes",
        "Aequornithes",
        "Feraequornithes",
        "Pelecanimorphae"
    ],
    "Suliformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Phaethoquornithes",
        "Aequornithes",
        "Feraequornithes",
        "Pelecanimorphae",
        "Pelecanes"
    ],
    "Pelecaniformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Phaethoquornithes",
        "Aequornithes",
        "Feraequornithes",
        "Pelecanimorphae",
        "Pelecanes"
    ],
    "Phaethontiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Phaethoquornithes",
        "Phaethontimorphae"
    ],
    "Eurypygiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Phaethoquornithes",
        "Phaethontimorphae"
    ],
    "Caprimulgiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Strisores"
    ],
    "Steatornithiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Strisores"
    ],
    "Nyctibiiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Strisores"
    ],
    "Podargiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Strisores"
    ],
    "Aegotheliformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Strisores"
    ],
    "Apodiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Strisores"
    ],
    "Opisthocomiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Opisthocomiformes"
    ],
    "Gruiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Cursorimorphae"
    ],
    "Charadriiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Elementaves",
        "Cursorimorphae"
    ],
    "Accipitriformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Hieraves"
    ],
    "Cathartiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Hieraves"
    ],
    "Strigiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Hieraves"
    ],
    "Coliiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Coraciimorphae"
    ],
    "Leptosomiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Coraciimorphae",
        "Cavitaves"
    ],
    "Trogoniformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Coraciimorphae",
        "Cavitaves",
        "Eucavitaves"
    ],
    "Bucerotiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Coraciimorphae",
        "Cavitaves",
        "Eucavitaves",
        "Picocoraciae"
    ],
    "Coraciiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Coraciimorphae",
        "Cavitaves",
        "Eucavitaves",
        "Picocoraciae",
        "Picodynastornithes"
    ],
    "Piciformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Coraciimorphae",
        "Cavitaves",
        "Eucavitaves",
        "Picocoraciae",
        "Picodynastornithes"
    ],
    "Cariamiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Australaves"
    ],
    "Falconiformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Australaves",
        "Eufalconimorphae"
    ],
    "Psittaciformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Australaves",
        "Eufalconimorphae",
        "Psittacopasserae"
    ],
    "Passeriformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Australaves",
        "Eufalconimorphae",
        "Psittacopasserae"
    ],
    "Galbuliformes": [
        "Neornithes",
        "Neognathae",
        "Neoaves",
        "Telluraves",
        "Afroaves",
        "Coraciimorphae",
        "Cavitaves",
        "Eucavitaves",
        "Picocoraciae",
        "Picodynastornithes"
    ]
}

# Additional family-level passerine clades. These are appended after the
# order-level backbone and are based on the current Wikipedia passerine
# phylogeny, which follows Oliveros et al. (2019) for these subdivisions.
PASSERINE_FAMILY_CLADE_PATHS = {
    "Philepittidae": [
        "Eupasseres",
        "Tyranni",
        "Eurylaimides"
    ],
    "Eurylaimidae": [
        "Eupasseres",
        "Tyranni",
        "Eurylaimides"
    ],
    "Calyptomenidae": [
        "Eupasseres",
        "Tyranni",
        "Eurylaimides"
    ],
    "Sapayoidae": [
        "Eupasseres",
        "Tyranni",
        "Eurylaimides"
    ],
    "Pittidae": [
        "Eupasseres",
        "Tyranni",
        "Eurylaimides"
    ],
    "Melanopareiidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Furnariida"
    ],
    "Conopophagidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Furnariida"
    ],
    "Thamnophilidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Furnariida"
    ],
    "Grallariidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Furnariida"
    ],
    "Rhinocryptidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Furnariida"
    ],
    "Formicariidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Furnariida"
    ],
    "Furnariidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Furnariida"
    ],
    "Pipridae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Tyrannida"
    ],
    "Cotingidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Tyrannida"
    ],
    "Tityridae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Tyrannida"
    ],
    "Oxyruncidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Tyrannida"
    ],
    "Onychorhynchidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Tyrannida"
    ],
    "Tyrannidae": [
        "Eupasseres",
        "Tyranni",
        "Tyrannides",
        "Tyrannida"
    ],
    "Atrichornithidae": [
        "Eupasseres",
        "Passeri",
        "Menurides"
    ],
    "Menuridae": [
        "Eupasseres",
        "Passeri",
        "Menurides"
    ],
    "Climacteridae": [
        "Eupasseres",
        "Passeri",
        "Climacterides"
    ],
    "Ptilonorhynchidae": [
        "Eupasseres",
        "Passeri",
        "Climacterides"
    ],
    "Pomatostomidae": [
        "Eupasseres",
        "Passeri",
        "Orthonynchides"
    ],
    "Orthonychidae": [
        "Eupasseres",
        "Passeri",
        "Orthonynchides"
    ],
    "Acanthizidae": [
        "Eupasseres",
        "Passeri",
        "Meliphagides",
        "Meliphagoidea"
    ],
    "Meliphagidae": [
        "Eupasseres",
        "Passeri",
        "Meliphagides",
        "Meliphagoidea"
    ],
    "Maluridae": [
        "Eupasseres",
        "Passeri",
        "Meliphagides",
        "Meliphagoidea"
    ],
    "Dasyornithidae": [
        "Eupasseres",
        "Passeri",
        "Meliphagides",
        "Meliphagoidea"
    ],
    "Pardalotidae": [
        "Eupasseres",
        "Passeri",
        "Meliphagides",
        "Meliphagoidea"
    ],
    "Cinclosomatidae": [
        "Eupasseres",
        "Passeri",
        "Corvides"
    ],
    "Campephagidae": [
        "Eupasseres",
        "Passeri",
        "Corvides"
    ],
    "Mohouidae": [
        "Eupasseres",
        "Passeri",
        "Corvides"
    ],
    "Neosittidae": [
        "Eupasseres",
        "Passeri",
        "Corvides"
    ],
    "Psophodidae": [
        "Eupasseres",
        "Passeri",
        "Orioloidea"
    ],
    "Eulacestomatidae": [
        "Eupasseres",
        "Passeri",
        "Orioloidea"
    ],
    "Falcunculidae": [
        "Eupasseres",
        "Passeri",
        "Orioloidea"
    ],
    "Oreoicidae": [
        "Eupasseres",
        "Passeri",
        "Orioloidea"
    ],
    "Paramythiidae": [
        "Eupasseres",
        "Passeri",
        "Orioloidea"
    ],
    "Vireonidae": [
        "Eupasseres",
        "Passeri",
        "Orioloidea"
    ],
    "Pachycephalidae": [
        "Eupasseres",
        "Passeri",
        "Orioloidea"
    ],
    "Oriolidae": [
        "Eupasseres",
        "Passeri",
        "Orioloidea"
    ],
    "Machaerirhynchidae": [
        "Eupasseres",
        "Passeri",
        "Malaconotoidea"
    ],
    "Artamidae": [
        "Eupasseres",
        "Passeri",
        "Malaconotoidea"
    ],
    "Rhipiduridae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Dicruridae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Laniidae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Corvidae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Paridae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Remizidae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Regulidae": [
        "Eupasseres",
        "Passeri",
        "Reguloidea"
    ],
    "Bombycillidae": [
        "Eupasseres",
        "Passeri",
        "Bombycilloidea"
    ],
    "Certhiidae": [
        "Eupasseres",
        "Passeri",
        "Certhioidea"
    ],
    "Sittidae": [
        "Eupasseres",
        "Passeri",
        "Certhioidea"
    ],
    "Troglodytidae": [
        "Eupasseres",
        "Passeri",
        "Certhioidea"
    ],
    "Muscicapidae": [
        "Eupasseres",
        "Passeri",
        "Muscicapoidea"
    ],
    "Turdidae": [
        "Eupasseres",
        "Passeri",
        "Muscicapoidea"
    ],
    "Sturnidae": [
        "Eupasseres",
        "Passeri",
        "Muscicapoidea"
    ],
    "Buphagidae": [
        "Eupasseres",
        "Passeri",
        "Muscicapoidea"
    ],
    "Cinclidae": [
        "Eupasseres",
        "Passeri",
        "Muscicapoidea"
    ],
    "Polioptilidae": [
        "Eupasseres",
        "Passeri",
        "Certhioidea"
    ],
    "Motacillidae": [
        "Eupasseres",
        "Passeri",
        "Passeroidea"
    ],
    "Prunellidae": [
        "Eupasseres",
        "Passeri",
        "Passeroidea"
    ],
    "Passeridae": [
        "Eupasseres",
        "Passeri",
        "Passeroidea"
    ],
    "Nectariniidae": [
        "Eupasseres",
        "Passeri",
        "Passerida"
    ],
    "Dicaeidae": [
        "Eupasseres",
        "Passeri",
        "Passerida"
    ],
    "Chloropseidae": [
        "Eupasseres",
        "Passeri",
        "Passerida"
    ],
    "Irenidae": [
        "Eupasseres",
        "Passeri",
        "Passerida"
    ],
    "Urocynchramidae": [
        "Eupasseres",
        "Passeri",
        "Passerida"
    ],
    "Estrildidae": [
        "Eupasseres",
        "Passeri",
        "Ploceoidea"
    ],
    "Ploceidae": [
        "Eupasseres",
        "Passeri",
        "Ploceoidea"
    ],
    "Viduidae": [
        "Eupasseres",
        "Passeri",
        "Ploceoidea"
    ],
    "Fringillidae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Passerida",
        "Fringilloidea"
    ],
    "Peucedramidae": [
        "Eupasseres",
        "Passeri",
        "Passerida"
    ],
    "Icteridae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Parulidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Icteriidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Phaenicophilidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Zeledoniidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Teretistridae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Thraupidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Mitrospingidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Rhodinocichlidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Calyptophilidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Nesospingidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Spindalidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Cardinalidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Emberizidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Passerellidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Calcariidae": [
        "Eupasseres",
        "Passeri",
        "Emberizoidea"
    ],
    "Acanthisittidae": [
        "Acanthisitti"
    ],
    "Rhagologidae": [
        "Eupasseres",
        "Passeri",
        "Malaconotoidea"
    ],
    "Malaconotidae": [
        "Eupasseres",
        "Passeri",
        "Malaconotoidea"
    ],
    "Pityriasidae": [
        "Eupasseres",
        "Passeri",
        "Malaconotoidea"
    ],
    "Aegithinidae": [
        "Eupasseres",
        "Passeri",
        "Malaconotoidea"
    ],
    "Platysteiridae": [
        "Eupasseres",
        "Passeri",
        "Malaconotoidea"
    ],
    "Vangidae": [
        "Eupasseres",
        "Passeri",
        "Malaconotoidea"
    ],
    "Monarchidae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Ifritidae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Paradisaeidae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Corcoracidae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Melampittidae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Platylophidae": [
        "Eupasseres",
        "Passeri",
        "Corvoidea"
    ],
    "Cnemophilidae": [
        "Eupasseres",
        "Passeri",
        "Passerides"
    ],
    "Melanocharitidae": [
        "Eupasseres",
        "Passeri",
        "Passerides"
    ],
    "Callaeidae": [
        "Eupasseres",
        "Passeri",
        "Passerides"
    ],
    "Notiomystidae": [
        "Eupasseres",
        "Passeri",
        "Passerides"
    ],
    "Petroicidae": [
        "Eupasseres",
        "Passeri",
        "Passerides"
    ],
    "Eupetidae": [
        "Eupasseres",
        "Passeri",
        "Passerides"
    ],
    "Picathartidae": [
        "Eupasseres",
        "Passeri",
        "Passerides"
    ],
    "Chaetopidae": [
        "Eupasseres",
        "Passeri",
        "Passerides"
    ],
    "Hyliotidae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Stenostiridae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Panuridae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Alaudidae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Nicatoridae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Macrosphenidae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Cisticolidae": [
        "Eupasseres",
        "Passeri",
        "Passerides",
        "Sylviida"
    ],
    "Acrocephalidae": [
        "Eupasseres",
        "Passeri",
        "Locustelloidea"
    ],
    "Locustellidae": [
        "Eupasseres",
        "Passeri",
        "Locustelloidea"
    ],
    "Donacobiidae": [
        "Eupasseres",
        "Passeri",
        "Locustelloidea"
    ],
    "Bernieridae": [
        "Eupasseres",
        "Passeri",
        "Locustelloidea"
    ],
    "Pnoepygidae": [
        "Eupasseres",
        "Passeri",
        "Hirundinoidea"
    ],
    "Hirundinidae": [
        "Eupasseres",
        "Passeri",
        "Hirundinoidea"
    ],
    "Pycnonotidae": [
        "Eupasseres",
        "Passeri",
        "Sylvioidea"
    ],
    "Sylviidae": [
        "Eupasseres",
        "Passeri",
        "Sylvioidea"
    ],
    "Paradoxornithidae": [
        "Eupasseres",
        "Passeri",
        "Sylvioidea"
    ],
    "Zosteropidae": [
        "Eupasseres",
        "Passeri",
        "Sylvioidea"
    ],
    "Timaliidae": [
        "Eupasseres",
        "Passeri",
        "Sylvioidea"
    ],
    "Leiothrichidae": [
        "Eupasseres",
        "Passeri",
        "Sylvioidea"
    ],
    "Pellorneidae": [
        "Eupasseres",
        "Passeri",
        "Sylvioidea"
    ],
    "Phylloscopidae": [
        "Eupasseres",
        "Passeri",
        "Aegithaloidea"
    ],
    "Hyliidae": [
        "Eupasseres",
        "Passeri",
        "Aegithaloidea"
    ],
    "Aegithalidae": [
        "Eupasseres",
        "Passeri",
        "Aegithaloidea"
    ],
    "Cettiidae": [
        "Eupasseres",
        "Passeri",
        "Aegithaloidea"
    ],
    "Erythrocercidae": [
        "Eupasseres",
        "Passeri",
        "Aegithaloidea"
    ],
    "Dulidae": [
        "Eupasseres",
        "Passeri",
        "Bombycilloidea"
    ],
    "Ptiliogonatidae": [
        "Eupasseres",
        "Passeri",
        "Bombycilloidea"
    ],
    "Hylocitreidae": [
        "Eupasseres",
        "Passeri",
        "Bombycilloidea"
    ],
    "Hypocoliidae": [
        "Eupasseres",
        "Passeri",
        "Bombycilloidea"
    ],
    "Mohoidae": [
        "Eupasseres",
        "Passeri",
        "Bombycilloidea"
    ],
    "Elachuridae": [
        "Eupasseres",
        "Passeri",
        "Muscicapoidea"
    ],
    "Mimidae": [
        "Eupasseres",
        "Passeri",
        "Muscicapoidea"
    ],
    "Tichodromidae": [
        "Eupasseres",
        "Passeri",
        "Certhioidea"
    ],
    "Salpornithidae": [
        "Eupasseres",
        "Passeri",
        "Certhioidea"
    ],
    "Promeropidae": [
        "Eupasseres",
        "Passeri",
        "Passerida"
    ],
    "Modulatricidae": [
        "Eupasseres",
        "Passeri",
        "Passerida"
    ]
}

RANKS = ["class", "order", "family", "genus", "species"]


def clean(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def normalize_header(value):
    if value is None:
        return ""
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def find_col(headers, candidates):
    normalized = {
        normalize_header(header): index
        for index, header in enumerate(headers)
        if header is not None
    }

    for candidate in candidates:
        key = normalize_header(candidate)
        if key in normalized:
            return normalized[key]

    for key, index in normalized.items():
        if any(normalize_header(candidate) in key for candidate in candidates):
            return index

    return None


def taxon_id(rank, name):
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return f"{rank}:{safe_name}"


def load_clade_parent_map(path):
    """Load the authoritative clade -> parent relationships from clades.json."""
    if not path.exists():
        return {}

    data = json.loads(path.read_text(encoding="utf-8"))
    parents = {}

    for entry in data.values():
        if not isinstance(entry, dict):
            continue

        name = clean(entry.get("name"))
        parent = clean(entry.get("parent"))
        if not name or not parent:
            continue

        if parent.startswith("clade:"):
            parent = parent.split(":", 1)[1]

        parents[name] = parent

    return parents


def normalize_clade_path(path, parent_by_name):
    """Restore every known parent and return a broad-to-specific path."""
    result = []
    visiting = set()

    def add(name):
        name = clean(name)
        if not name or name in result:
            return

        if name in visiting:
            return

        visiting.add(name)
        parent = parent_by_name.get(name)
        if parent:
            add(parent)
        visiting.discard(name)

        if name not in result:
            result.append(name)

    for name in path or []:
        add(name)

    return result


def merge_clade_paths(order_path, family_path, parent_by_name):
    """Merge broad order placement with finer family placement.

    For example, a passerine path containing Passeri is automatically
    completed with its known parent Eupasseres before being written.
    """
    combined = []

    for name in order_path or []:
        if name not in combined:
            combined.append(name)

    for name in family_path or []:
        if name not in combined:
            combined.append(name)

    return normalize_clade_path(combined, parent_by_name)


def load_thai_names(path):
    """Load Thai names from the eBird workbook.

    The current eBird workbook stores:
      - English common name: column E
      - Scientific name: column F
      - Thai name: column DV

    Use the fixed columns because the workbook's headers are not reliable
    enough for automatic layout detection.
    """
    if not path:
        return {}

    wb = load_workbook(path, read_only=True, data_only=True)
    thai_names = {}
    thai_names_by_common = {}

    for ws in wb.worksheets:
        loaded = 0

        # Excel columns are 1-based; openpyxl uses 0-based indexes here.
        # E = 5 -> index 4, F = 6 -> index 5, DV = 126 -> index 125.
        for row in ws.iter_rows(min_row=2, values_only=True):
            if len(row) <= 125:
                continue

            common = clean(row[4])
            scientific = clean(row[5])
            thai = clean(row[125])

            # Require the scientific name and Thai name. The English name
            # is present in this workbook but is not needed as the key.
            if not scientific or not thai:
                continue

            # Avoid accidentally reading another worksheet with unrelated
            # data if the workbook contains multiple sheets.
            if " " not in scientific:
                continue

            thai_names[scientific] = thai
            if common:
                thai_names_by_common.setdefault(common, set()).add(thai)
            loaded += 1

        if loaded:
            print(f"Loaded {loaded:,} Thai bird names from {ws.title!r}.")
            # The workbook may contain several views of the same data.
            # Once a sheet has supplied the names, no further layout
            # detection is necessary.
            return {
                "by_scientific": thai_names,
                "by_common": thai_names_by_common,
            }

    raise SystemExit(
        "Could not load Thai names from the eBird workbook using "
        "columns E (English), F (scientific), and DV (Thai)."
    )


def thai_name_for_bird(bird, thai_names):
    """Resolve a Thai name across scientific-name taxonomy changes.

    Prefer an exact scientific-name match. If AviList uses a different
    scientific combination for the same species, use the English common name
    only when that common name maps to exactly one Thai name in the eBird
    workbook. This is safer than matching only the species epithet, which can
    collide across unrelated taxa.
    """
    scientific = clean(bird.get("scientificName"))
    common = clean(bird.get("commonName"))
    if not scientific:
        return None

    by_scientific = thai_names.get("by_scientific", {})
    by_common = thai_names.get("by_common", {})

    exact = by_scientific.get(scientific)
    if exact:
        return exact

    # Known historical combinations can be mapped explicitly when needed.
    # Keep these species-level aliases rather than using a broad genus or
    # epithet heuristic.
    scientific_aliases = {
        "Sittiparus semilarvatus": {
            "Parus semilarvatus",
            "Cyanistes semilarvatus",
            "Melaniparus semilarvatus",
        },
    }

    for alias in scientific_aliases.get(scientific, set()):
        thai = by_scientific.get(alias)
        if thai:
            return thai

    # Last-resort matching by English common name is allowed only when the
    # eBird workbook has exactly one Thai value for that name.
    if common:
        candidates = by_common.get(common, set())
        if len(candidates) == 1:
            return next(iter(candidates))

    return None

def find_avilist_sheet(workbook):
    # Prefer the known current name, but normalize case/spacing so the
    # importer also works with harmless naming differences.
    preferred = "AviList v2025b extended"
    if preferred in workbook.sheetnames:
        return workbook[preferred]

    target = normalize_header(preferred)
    for sheet_name in workbook.sheetnames:
        normalized = normalize_header(sheet_name)
        if normalized == target:
            return workbook[sheet_name]

    # Fallback: find any sheet containing both "avilist" and "extended".
    for sheet_name in workbook.sheetnames:
        normalized = normalize_header(sheet_name)
        if "avilist" in normalized and "extended" in normalized:
            return workbook[sheet_name]

    available = ", ".join(repr(name) for name in workbook.sheetnames)
    raise SystemExit(
        "Could not find the AviList extended worksheet. "
        f"Available worksheets: {available}"
    )



def validate_import(birds, taxa):
    print("\n=== MetaAves Import Validation ===")

    missing_fields = {
        "commonName": [],
        "scientificName": [],
        "order": [],
        "family": [],
        "genus": []
    }

    for bird in birds:
        for field in missing_fields:
            if not bird.get(field):
                missing_fields[field].append(bird.get("scientificName") or bird.get("commonName") or "<unknown>")

    def duplicate_count(values):
        seen = set()
        duplicates = set()
        for value in values:
            if not value:
                continue
            if value in seen:
                duplicates.add(value)
            seen.add(value)
        return len(duplicates)

    duplicate_scientific = duplicate_count(
        bird.get("scientificName") for bird in birds
    )
    duplicate_common = duplicate_count(
        bird.get("commonName") for bird in birds
    )

    extinct_count = sum(1 for bird in birds if bird.get("isExtinct"))

    invalid_taxon_parents = [
        taxon_id_value
        for taxon_id_value, taxon in taxa.items()
        if taxon_id_value != "class:Aves"
        and taxon.get("parent") not in taxa
    ]

    root = taxa.get("class:Aves")
    invalid_root = (
        not root
        or root.get("rank") != "class"
        or root.get("name") != "Aves"
        or root.get("parent") is not None
    )

    print(f"Species imported:        {len(birds):,}")
    print(f"Extinct/possibly extinct:{extinct_count:,}")
    print(f"Taxonomy nodes:          {len(taxa):,}")
    print()
    print(f"Missing common names:    {len(missing_fields['commonName']):,}")
    print(f"Missing scientific names:{len(missing_fields['scientificName']):,}")
    print(f"Missing order:           {len(missing_fields['order']):,}")
    print(f"Missing family:          {len(missing_fields['family']):,}")
    print(f"Missing genus:           {len(missing_fields['genus']):,}")
    print()
    print(f"Duplicate scientific:    {duplicate_scientific:,}")
    print(f"Duplicate common names:  {duplicate_common:,}")
    print(f"Invalid taxon parents:   {len(invalid_taxon_parents):,}")
    print(f"Invalid Aves root:       {'YES' if invalid_root else 'NO'}")

    errors = (
        any(missing_fields.values())
        or duplicate_scientific > 0
        or invalid_taxon_parents
        or invalid_root
    )

    if errors:
        print("\nSTATUS: CHECK REQUIRED")
        for field, values in missing_fields.items():
            if values:
                print(f"  {field}: {values[:5]}")
        if invalid_taxon_parents:
            print(f"  Invalid parent examples: {invalid_taxon_parents[:5]}")
        return False

    print("\nSTATUS: PASS")
    return True


def main():
    if len(sys.argv) not in {2, 3}:
        raise SystemExit(
            "Usage: python scripts/import_avilist.py <AviList-extended.xlsx> "
            "[ebird-common-names.xlsx]"
        )

    xlsx = Path(sys.argv[1])
    ebird_names_path = Path(sys.argv[2]) if len(sys.argv) == 3 else None
    if not xlsx.exists():
        raise SystemExit(f"File not found: {xlsx}")

    thai_names = load_thai_names(ebird_names_path) if ebird_names_path else {}

    wb = load_workbook(xlsx, read_only=True, data_only=True)
    ws = find_avilist_sheet(wb)

    print(f"Using worksheet: {ws.title}")

    rows = ws.iter_rows(values_only=True)
    headers = next(rows)

    cols = {
        "rank": find_col(headers, ["Taxon_rank", "Rank"]),
        "english": find_col(headers, ["English_name_AviList", "English_name"]),
        "scientific": find_col(headers, ["Scientific_name"]),
        "order": find_col(headers, ["Order"]),
        "family": find_col(headers, ["Family"]),
        "genus": find_col(headers, ["Genus"]),
        "extinct": find_col(headers, ["Extinct_or_possibly_extinct"]),
        "range": find_col(headers, ["Range"]),
        "iucn": find_col(headers, ["IUCN_Red_List_Category"]),
    }

    missing = [
        key for key, value in cols.items()
        if value is None and key in {"rank", "english", "scientific"}
    ]
    if missing:
        raise SystemExit(
            "Could not find required AviList columns: "
            + ", ".join(missing)
        )

    birds = []
    clade_membership = {}
    post_order_clade_membership = {}
    unmapped_orders = set()

    clade_parent_by_name = load_clade_parent_map(
        Path("data") / "clades.json"
    )

    taxa = {
        "class:Aves": {
            "id": "class:Aves",
            "rank": "class",
            "name": "Aves",
            "parent": None,
            "children": []
        }
    }

    for row in rows:
        rank = clean(row[cols["rank"]])

        if rank != "species":
            continue

        common = clean(row[cols["english"]])
        scientific = clean(row[cols["scientific"]])

        if not common or not scientific:
            continue

        # AviList's extended sheet may leave the Genus column blank even
        # though the scientific name is binomial. Use the explicit Genus
        # value when present; otherwise derive the genus from the first
        # nomenclatural token of the scientific name.
        genus = (
            clean(row[cols["genus"]])
            if cols["genus"] is not None
            else None
        )
        if not genus:
            genus = scientific.split()[0]

        bird = {
            "commonName": common,
            "scientificName": scientific,
            "thaiName": None,
            "isExtinct": False,
            "kingdom": "Animalia",
            "phylum": "Chordata",
            "class": "Aves",
            "order": clean(row[cols["order"]]) if cols["order"] is not None else None,
            "family": clean(row[cols["family"]]) if cols["family"] is not None else None,
            "genus": genus,
            "species": scientific,
            "habitat": None,
            "distribution": clean(row[cols["range"]]) if cols["range"] is not None else None,
            "diet": None,
            "behavior": None,
            "breeding": None,
            "conservation": clean(row[cols["iucn"]]) if cols["iucn"] is not None else None,
            "interestingFacts": [],
            "wikipediaTitle": common,
            "genusCharacteristics": []
        }

        extinct_value = clean(row[cols["extinct"]]) if cols["extinct"] is not None else None
        bird["thaiName"] = thai_name_for_bird(bird, thai_names)

        bird["isExtinct"] = bool(
            extinct_value
            and extinct_value.lower() in {
                "yes", "true", "extinct", "possibly extinct"
            }
        )

        birds.append(bird)

        order_name = bird.get("order")
        order_clade_path = list(CLADE_PATHS_BY_ORDER.get(order_name, []))

        family_name = bird.get("family")
        family_clade_path = (
            PASSERINE_FAMILY_CLADE_PATHS.get(family_name)
            if order_name == "Passeriformes"
            else None
        )

        # Build one broad-to-specific lineage.  The family path supplies the
        # finer passerine split, while clades.json restores any missing
        # ancestors such as Eupasseres.
        clade_path = merge_clade_paths(
            order_clade_path,
            family_clade_path,
            clade_parent_by_name,
        )

        if clade_path:
            clade_membership[scientific] = clade_path

        if family_clade_path:
            post_order_clade_membership[scientific] = normalize_clade_path(
                family_clade_path,
                clade_parent_by_name,
            )
        elif order_name:
            unmapped_orders.add(order_name)

        parent_id = "class:Aves"

        for tax_rank in RANKS[RANKS.index("class") + 1:]:
            value = bird.get(tax_rank)
            if not value:
                continue

            current_id = taxon_id(tax_rank, value)

            if current_id not in taxa:
                taxa[current_id] = {
                    "id": current_id,
                    "rank": tax_rank,
                    "name": value,
                    "parent": parent_id,
                    "children": []
                }

                if parent_id in taxa:
                    if current_id not in taxa[parent_id]["children"]:
                        taxa[parent_id]["children"].append(current_id)

            parent_id = current_id

        species_id = taxon_id("species", scientific)

        if species_id not in taxa:
            taxa[species_id] = {
                "id": species_id,
                "rank": "species",
                "name": scientific,
                "commonName": common,
                "parent": parent_id,
                "children": []
            }
            taxa[parent_id]["children"].append(species_id)

    out = Path("data")
    out.mkdir(exist_ok=True)

    (out / "clade_membership.generated.json").write_text(
        json.dumps(
            {
                "_meta": {
                    "version": 2,
                    "generatedBy": "scripts/import_avilist.py",
                    "source": "Wikipedia bird phylogeny pages, using Stiller et al. 2024 where those pages identify that topology",
                    "policy": "Detailed named clades are included where the source provides a usable lineage. Contested alternative deep Neoaves relationships are not mixed into the same lineage."
                },
                "species": clade_membership,
                "postOrderSpecies": post_order_clade_membership
            },
            ensure_ascii=False,
            indent=2
        ),
        encoding="utf-8"
    )

    (out / "birds.generated.json").write_text(
        json.dumps(birds, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    taxonomy = {
        "_meta": {
            "version": 4,
            "masterSource": {
                "name": "AviList: The Global Avian Checklist",
                "version": "2025b"
            },
            "generatedBy": "scripts/import_avilist.py",
            "rankOrder": RANKS,
            "rootTaxa": ["class:Aves"],
            "nodeTypes": ["ranked_taxon", "species"],
            "taxonomyPolicy": "Classic MetaAves taxonomy uses only Class → Order → Family → Genus → Species. Named phylogenetic clades are maintained separately.",
            "clades": (
                "Maintained separately from ranked taxonomy. "
                "The game can insert clade nodes between ranked taxa."
            )
        }
    }
    taxonomy.update(taxa)

    (out / "taxonomy.generated.json").write_text(
        json.dumps(taxonomy, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"Imported {len(birds):,} species")
    print(f"Generated {len(taxa):,} ranked taxonomy nodes")
    print(f"Clade memberships: {len(clade_membership):,}")
    print(f"Post-order clade memberships: {len(post_order_clade_membership):,}")
    print(f"Orders without a clade mapping: {len(unmapped_orders):,}")
    if unmapped_orders:
        print("Unmapped orders:", ", ".join(sorted(unmapped_orders)))
    print("Wrote data/birds.generated.json")
    print("Wrote data/taxonomy.generated.json")
    print("Wrote data/clade_membership.generated.json")

    validate_import(birds, taxa)


if __name__ == "__main__":
    main()
